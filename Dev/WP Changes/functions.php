<?php
/**
 * REST endpoints for status + updates (core/plugins)
 * - /wp-json/site/v1/status            (GET, supports ?refresh=1)
 * - /wp-json/custom/v1/update-plugins  (POST, accepts ["a/b.php", ...] or {"plugins":"all"})
 * - /wp-json/custom/v1/update-core     (POST)
 */

// Ensure admin update APIs are available
require_once ABSPATH . 'wp-admin/includes/update.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/theme.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';


/* ===========================
   STATUS: site/v1/status
   =========================== */
add_action('rest_api_init', function () {
  register_rest_route('site/v1', '/status', [
    'methods'             => 'GET',
    'permission_callback' => '__return_true', // tighten if needed
    'callback'            => function ( WP_REST_Request $req ) {
      require_once ABSPATH . 'wp-includes/version.php';

      // Optional: /status?refresh=1 forces fresh checks
      $force = (bool) $req->get_param('refresh');
      if ($force) {
        delete_site_transient('update_core');
        delete_site_transient('update_plugins');
        delete_site_transient('update_themes');
      }

      // Trigger/refresh the transients (mirrors WP Admin behavior)
      wp_version_check();
      wp_update_plugins();
      wp_update_themes();

      // ----- CORE (always return latest_version) -----
      $installed     = $GLOBALS['wp_version'];
      $core_updates  = get_core_updates(); // canonical source
      $candidate     = (is_array($core_updates) && !empty($core_updates)) ? $core_updates[0] : null;
      $latest        = $installed;
      if ($candidate && is_object($candidate)) {
        $latest = $candidate->current ?? ($candidate->version ?? $installed);
      }
      $core_info = [
        'current_version'  => $installed,
        'update_available' => version_compare($latest, $installed, '>'),
        'latest_version'   => $latest,
      ];

      // ----- PHP & MySQL -----
      global $wpdb;
      $php_mysql_info = [
        'php_version'   => phpversion(),
        'mysql_version' => $wpdb->db_version(),
      ];

      // ----- PLUGINS -----
      $all_plugins    = get_plugins();
      $active_plugins = get_option('active_plugins', []);
      $plugin_updates = get_plugin_updates(); // keyed by plugin_file
      $plugin_info    = [];

      foreach ($all_plugins as $plugin_file => $plugin_data) {
        $update = $plugin_updates[$plugin_file] ?? null;
        $latest_version = ($update && isset($update->update->new_version))
          ? $update->update->new_version
          : $plugin_data['Version'];

        $plugin_info[] = [
          'plugin_file'      => $plugin_file, // e.g. 'akismet/akismet.php'
          'slug'             => sanitize_title($plugin_data['Name']),
          'name'             => $plugin_data['Name'],
          'version'          => $plugin_data['Version'],
          'active'           => in_array($plugin_file, $active_plugins, true),
          'update_available' => (bool) $update,
          'latest_version'   => $latest_version,
        ];
      }

      // ----- THEMES -----
      $themes        = wp_get_themes();
      $active_theme  = wp_get_theme();
      $theme_updates = get_theme_updates(); // keyed by stylesheet
      $theme_info    = [];

      foreach ($themes as $stylesheet => $theme) {
        $update = $theme_updates[$stylesheet] ?? null;
        $theme_info[] = [
          'name'             => $theme->get('Name'),
          'version'          => $theme->get('Version'),
          'active'           => ($theme->get_stylesheet() === $active_theme->get_stylesheet()),
          'update_available' => (bool) $update,
          'latest_version'   => $update['new_version'] ?? $theme->get('Version'),
        ];
      }

      return [
        'core'      => $core_info,
        'php_mysql' => $php_mysql_info,
        'plugins'   => $plugin_info,
        'themes'    => $theme_info,
      ];
    },
  ]);
});

/* ======================================
   UPDATE PLUGINS: custom/v1/update-plugins
   - Body: {"plugins":["a/b.php","c/d.php"]}  OR  {"plugins":"all"}
   ====================================== */
add_action('rest_api_init', function () {
  register_rest_route('custom/v1', '/update-plugins', [
    'methods'             => 'POST',
    'callback'            => 'handle_plugin_update_request',
    'permission_callback' => function () { return current_user_can('update_plugins'); },
  ]);
});

function handle_plugin_update_request( WP_REST_Request $request ) {

  if ($request->get_param('dry_run')) {
    return new WP_REST_Response(['ok' => true, 'why' => 'auth + routing OK'], 200);
  }

  // Long runner headroom
  @ini_set('max_execution_time', '900');
  if (function_exists('set_time_limit')) { @set_time_limit(900); }

  // Ensure direct FS writes
  if (!defined('FS_METHOD')) define('FS_METHOD', 'direct');

  // Includes + filesystem
  require_once ABSPATH . 'wp-admin/includes/plugin.php';
  require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
  require_once ABSPATH . 'wp-admin/includes/file.php';
  require_once ABSPATH . 'wp-admin/includes/update.php';
  WP_Filesystem();

  // ---- Normalize input (JSON array/CSV, form array/CSV) ----
  $plugins = [];
  $data    = json_decode($request->get_body(), true);

  if (is_array($data) && array_key_exists('plugins', $data)) {
    if (is_array($data['plugins'])) {
      $plugins = array_map('strval', $data['plugins']);
    } elseif (is_string($data['plugins'])) {
      $plugins = preg_split('/\s*,\s*/', $data['plugins'], -1, PREG_SPLIT_NO_EMPTY);
    }
  }

  if (empty($plugins)) {
    $postedArr = $request->get_param('plugins');
    if (is_array($postedArr)) {
      $plugins = array_map('strval', $postedArr);
    } elseif (is_string($postedArr)) {
      $plugins = preg_split('/\s*,\s*/', $postedArr, -1, PREG_SPLIT_NO_EMPTY);
    }
  }

  // NEW: allow {"plugins":"all"} to update everything with an available update
  if (count($plugins) === 1 && strtolower($plugins[0]) === 'all') {
    wp_update_plugins();                 // refresh transient
    $updates = get_plugin_updates();     // keyed by plugin_file
    $plugins = array_keys($updates);     // only those needing updates
  }

  if (empty($plugins)) {
    return new WP_REST_Response(['ok' => false, 'error' => 'No plugins provided'], 400);
  }

  // Freshen before upgrades
  wp_update_plugins();

  // Quiet upgrader skin (suppress HTML output)
  $skin = new class extends WP_Upgrader_Skin {
    public function header() {}
    public function footer() {}
    public function feedback($string, ...$args) {}
    public function error($errors) {}
    public function before() {}
    public function after() {}
    public function get_upgrade_messages() { return $this->messages ?? []; }
  };

  $upgrader = new Plugin_Upgrader($skin);
  $results  = [];

  foreach ($plugins as $pf) {
    $pf = trim($pf);
    if ($pf === '') continue;

    $res = $upgrader->upgrade($pf);

    if (is_wp_error($res)) {
      $results[] = [
        'plugin' => $pf,
        'ok'     => false,
        'error'  => [
          'code'    => $res->get_error_code(),
          'message' => $res->get_error_message(),
          'data'    => $res->get_error_data(),
        ],
      ];
    } else {
      $ok = ($res === true) || (is_array($res) && empty($res['error']));
      $item = [ 'plugin' => $pf, 'ok' => (bool)$ok ];
      if (is_array($res)) $item['raw'] = $res; // surface raw result for debugging
      $results[] = $item;
    }
  }

  // Post-update: report installed versions
  $post = [];
  foreach ($plugins as $pf) {
    $data = get_plugin_data(WP_PLUGIN_DIR . '/' . $pf, false, false);
    $post[$pf] = [
      'name'    => $data['Name'] ?? null,
      'version' => $data['Version'] ?? null,
    ];
  }

  // Clear transient so next /status shows fresh
  delete_site_transient('update_plugins');

  $overall_ok = true;
  foreach ($results as $r) { if (empty($r['ok'])) { $overall_ok = false; break; } }

  return new WP_REST_Response([
    'ok'          => $overall_ok,
    'results'     => $results,
    'post_status' => $post,
  ], 200);
}

/* ==================================
   UPDATE CORE: custom/v1/update-core
   ================================== */
add_action('rest_api_init', function () {
  register_rest_route('custom/v1', '/update-core', [
    'methods'             => 'POST',
    'callback'            => 'custom_update_wp_core',
    'permission_callback' => function () { return current_user_can('update_core'); },
  ]);
});

function custom_update_wp_core( WP_REST_Request $request ) {
  // generous limits for core update
  @ini_set('max_execution_time', '1200');
  if (function_exists('set_time_limit')) { @set_time_limit(1200); }
  if (!defined('FS_METHOD')) define('FS_METHOD', 'direct');

  require_once ABSPATH . 'wp-admin/includes/update.php';
  require_once ABSPATH . 'wp-admin/includes/file.php';
  require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

  global $wp_filesystem;
  if (empty($wp_filesystem)) {
    WP_Filesystem();
  }

  // clear any stale lock and refresh update data
  delete_option('core_updater.lock');
  delete_site_transient('update_core');
  wp_version_check();

  $updates = get_core_updates();
  if (!is_array($updates) || empty($updates)) {
    return new WP_REST_Response(['message' => 'No core update info available'], 200);
  }

  // find an upgrade candidate
  $candidate = null;
  foreach ($updates as $u) {
    if (isset($u->response) && $u->response === 'upgrade') {
      $candidate = $u;
      break;
    }
  }
  if (!$candidate) {
    return new WP_REST_Response(['message' => 'No core update available'], 200);
  }

  // Silent skin
  if (!class_exists('Silent_Upgrader_Skin')) {
    class Silent_Upgrader_Skin extends WP_Upgrader_Skin {
      public function header() {}
      public function footer() {}
      public function feedback($string, ...$args) {}
      public function error($errors) {}
      public function before() {}
      public function after() {}
    }
  }

  try {
    $upgrader = new Core_Upgrader(new Silent_Upgrader_Skin());
    $result   = $upgrader->upgrade($candidate);
  } catch (Throwable $e) {
    return new WP_REST_Response(['error' => $e->getMessage()], 500);
  }

  if (is_wp_error($result)) {
    return new WP_REST_Response(['error' => $result->get_error_message()], 500);
  }

  // clear to force fresh status next time
  delete_site_transient('update_core');

  return new WP_REST_Response(['message' => 'WordPress core updated successfully'], 200);
}
