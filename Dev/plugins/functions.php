<?php
/**
 * Twenty Twenty-Five functions and definitions.
 *
 * @link https://developer.wordpress.org/themes/basics/theme-functions/
 *
 * @package WordPress
 * @subpackage Twenty_Twenty_Five
 * @since Twenty Twenty-Five 1.0
 */

// Adds theme support for post formats.
if ( ! function_exists( 'twentytwentyfive_post_format_setup' ) ) :
	/**
	 * Adds theme support for post formats.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_post_format_setup() {
		add_theme_support( 'post-formats', array( 'aside', 'audio', 'chat', 'gallery', 'image', 'link', 'quote', 'status', 'video' ) );
	}
endif;
add_action( 'after_setup_theme', 'twentytwentyfive_post_format_setup' );

// Enqueues editor-style.css in the editors.
if ( ! function_exists( 'twentytwentyfive_editor_style' ) ) :
	/**
	 * Enqueues editor-style.css in the editors.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_editor_style() {
		add_editor_style( 'assets/css/editor-style.css' );
	}
endif;
add_action( 'after_setup_theme', 'twentytwentyfive_editor_style' );

// Enqueues style.css on the front.
if ( ! function_exists( 'twentytwentyfive_enqueue_styles' ) ) :
	/**
	 * Enqueues style.css on the front.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_enqueue_styles() {
		wp_enqueue_style(
			'twentytwentyfive-style',
			get_parent_theme_file_uri( 'style.css' ),
			array(),
			wp_get_theme()->get( 'Version' )
		);
	}
endif;
add_action( 'wp_enqueue_scripts', 'twentytwentyfive_enqueue_styles' );

// Registers custom block styles.
if ( ! function_exists( 'twentytwentyfive_block_styles' ) ) :
	/**
	 * Registers custom block styles.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_block_styles() {
		register_block_style(
			'core/list',
			array(
				'name'         => 'checkmark-list',
				'label'        => __( 'Checkmark', 'twentytwentyfive' ),
				'inline_style' => '
				ul.is-style-checkmark-list {
					list-style-type: "\2713";
				}

				ul.is-style-checkmark-list li {
					padding-inline-start: 1ch;
				}',
			)
		);
	}
endif;
add_action( 'init', 'twentytwentyfive_block_styles' );

// Registers pattern categories.
if ( ! function_exists( 'twentytwentyfive_pattern_categories' ) ) :
	/**
	 * Registers pattern categories.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_pattern_categories() {

		register_block_pattern_category(
			'twentytwentyfive_page',
			array(
				'label'       => __( 'Pages', 'twentytwentyfive' ),
				'description' => __( 'A collection of full page layouts.', 'twentytwentyfive' ),
			)
		);

		register_block_pattern_category(
			'twentytwentyfive_post-format',
			array(
				'label'       => __( 'Post formats', 'twentytwentyfive' ),
				'description' => __( 'A collection of post format patterns.', 'twentytwentyfive' ),
			)
		);
	}
endif;
add_action( 'init', 'twentytwentyfive_pattern_categories' );

// Registers block binding sources.
if ( ! function_exists( 'twentytwentyfive_register_block_bindings' ) ) :
	/**
	 * Registers the post format block binding source.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_register_block_bindings() {
		register_block_bindings_source(
			'twentytwentyfive/format',
			array(
				'label'              => _x( 'Post format name', 'Label for the block binding placeholder in the editor', 'twentytwentyfive' ),
				'get_value_callback' => 'twentytwentyfive_format_binding',
			)
		);
	}
endif;
add_action( 'init', 'twentytwentyfive_register_block_bindings' );

// Registers block binding callback function for the post format name.
if ( ! function_exists( 'twentytwentyfive_format_binding' ) ) :
	/**
	 * Callback function for the post format name block binding source.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return string|void Post format name, or nothing if the format is 'standard'.
	 */
	function twentytwentyfive_format_binding() {
		$post_format_slug = get_post_format();

		if ( $post_format_slug && 'standard' !== $post_format_slug ) {
			return get_post_format_string( $post_format_slug );
		}
	}
endif;


/* =========================================================================
   Core includes required by upgraders / status
   ========================================================================= */
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/theme.php';
require_once ABSPATH . 'wp-admin/includes/update.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
require_once ABSPATH . 'wp-admin/includes/file.php';

/* =========================================================================
   Global hardening (timeouts, temp, exec time)
   ========================================================================= */
add_filter('http_request_timeout', function($t){ return max((int)$t, 300); });
@ini_set('max_execution_time', '900');

// ✅ #1: Force ZipArchive over PclZip
add_filter('unzip_file_use_ziparchive', '__return_true');

/* =========================================================================
   Preflight checks (block risky upgrades that cause “vanish”)
   ========================================================================= */
function nh_updater_preflight_ok(&$why = null) {
  if ( ! class_exists('ZipArchive') ) {
    $why = 'PHP ZipArchive extension is missing'; return false;
  }
  if ( ! function_exists('curl_init') && ! ini_get('allow_url_fopen') ) {
    $why = 'No HTTP transport (enable cURL or allow_url_fopen)'; return false;
  }

  // must be writable: upgrade, upgrade-temp-backup/plugins, plugins
  $need_dirs = [
    WP_CONTENT_DIR . '/upgrade',
    WP_CONTENT_DIR . '/upgrade-temp-backup',
    WP_CONTENT_DIR . '/upgrade-temp-backup/plugins',
    WP_PLUGIN_DIR,
  ];
  foreach ($need_dirs as $d) {
    if ( ! is_dir($d) ) { wp_mkdir_p($d); }
    if ( ! wp_is_writable($d) ) { $why = basename($d) . ' is not writable'; return false; }
  }

  // 50 MB minimum free space in wp-content
  $free = @disk_free_space(WP_CONTENT_DIR);
  if ($free !== false && $free < 50*1024*1024) {
    $why = 'Low disk space in wp-content'; return false;
  }
  return true;
}

/* =========================================================================
   Robust downloader: guarantee a real .zip file path for the upgrader
   ========================================================================= */

/**
 * Optional: relax SSL verify if your box has a broken CA bundle.
 * Leave false unless you know you need it.
 */
if ( ! defined('NH_UPDATER_RELAX_SSL') ) {
  define('NH_UPDATER_RELAX_SSL', false);
}

/* Ensure the upgrader always prefers ZipArchive */
add_filter('unzip_file_use_ziparchive', '__return_true');

/* Give HTTP requests sane defaults for big zips */
add_filter('http_request_args', function($args, $url){
  $args['timeout']     = max( (int)($args['timeout'] ?? 0), 120 );
  $args['redirection'] = max( (int)($args['redirection'] ?? 0), 5 );
  if ( NH_UPDATER_RELAX_SSL ) {
    $args['sslverify'] = false;
  }
  return $args;
}, 10, 2);

// Prefer ZipArchive (avoid PclZip whenever possible)
add_filter('unzip_file_use_ziparchive', '__return_true');

// Make downloads robust and deterministic
remove_all_filters('upgrader_pre_download');
add_filter('upgrader_pre_download', function($reply, $package, $upgrader){

  // 1) Environment must be healthy
  $why = null;
  if ( ! nh_updater_preflight_ok($why) ) {
    return new WP_Error('nh_preflight_failed', 'Update blocked: '.$why);
  }

  // 2) If core already gave us an on-disk file, sanity-check and return it
  if ( is_string($package) && file_exists($package) ) {
    if ( filesize($package) > 0 ) {
      return $package;
    }
    return new WP_Error('nh_empty_package', 'Downloaded file exists but is empty: '.$package);
  }

  // 3) Expect a URL otherwise
  if ( ! is_string($package) || stripos($package, 'http') !== 0 ) {
    return new WP_Error('nh_bad_package', 'Invalid package reference (not a file or URL)');
  }

  // 4) Download to a PHP temp file
  $tmp = download_url($package, 120);
  if ( is_wp_error($tmp) ) {
    error_log('[NH Updater] download_url failed: '.$package.' :: '.$tmp->get_error_message());
    return $tmp;
  }

  // 5) Ensure a stable upgrade dir exists
  $upgrade_dir = trailingslashit( WP_CONTENT_DIR ) . 'upgrade';
  if ( ! is_dir($upgrade_dir) ) {
    wp_mkdir_p($upgrade_dir);
  }

  // 6) Choose a sane .zip filename (even if the source is a non-zip URL)
  $base = basename( parse_url($package, PHP_URL_PATH) );
  if ( ! $base || strpos($base, '.') === false ) {
    $base = 'package-' . time() . '.zip';
  }
  // Force .zip extension
  $base_l = strtolower($base);
  if ( ! str_ends_with($base_l, '.zip') ) {
    $base .= '.zip';
  }

  $dest = trailingslashit($upgrade_dir) . wp_unique_filename($upgrade_dir, $base);

  // 7) Move/copy tmp -> upgrade/filename.zip
  $moved = @rename($tmp, $dest);
  if ( ! $moved ) {
    $copied = @copy($tmp, $dest);
    @unlink($tmp);
    if ( ! $copied ) {
      error_log('[NH Updater] Failed moving downloaded file into upgrade dir: '.$dest);
      return new WP_Error('nh_move_failed', 'Could not move downloaded zip into upgrade directory');
    }
  }

  // 8) Final sanity: must exist & be non-empty; otherwise abort *before* unzip
  if ( ! file_exists($dest) ) {
    return new WP_Error('nh_missing_package', 'Downloaded zip vanished before unzip: '.$dest);
  }
  $size = @filesize($dest);
  if ( ! $size || $size < 32*1024 /* 32KB guard */ ) {
    return new WP_Error('nh_too_small_package', 'Downloaded zip is unexpectedly small: '.$dest.' ('.$size.' bytes)');
  }

  // 9) Hand the upgrader an absolute, verified path
  return $dest;

}, 10, 3);



/* =========================================================================
   Rescue / backup helpers
   ========================================================================= */
function nh_backup_plugin_dir(string $plugin_file) {
  $slug = dirname($plugin_file);
  $src  = WP_PLUGIN_DIR . '/' . $slug;
  if ( ! is_dir($src) ) return false;

  $backup_root = WP_CONTENT_DIR . '/plugin-backups';
  if ( ! is_dir($backup_root) ) wp_mkdir_p($backup_root);

  $backup = $backup_root . '/' . $slug . '-' . gmdate('Ymd-His');
  WP_Filesystem(); global $wp_filesystem;
  $ok = copy_dir($src, $backup);
  return is_wp_error($ok) ? $ok : $backup;
}

function nh_restore_plugin_backup(string $backup_path, string $plugin_file) {
  $slug = dirname($plugin_file);
  $dest = WP_PLUGIN_DIR . '/' . $slug;
  WP_Filesystem(); global $wp_filesystem;
  if ( $wp_filesystem->exists($dest) ) $wp_filesystem->delete($dest, true);
  $ok = copy_dir($backup_path, $dest);
  return is_wp_error($ok) ? $ok : true;
}

/** Rescue from both classic temp and the rollback folder (WP 6.5+) */
function nh_rescue_plugin_if_stuck($slug){
  $roots = [
    trailingslashit(WP_CONTENT_DIR).'upgrade',
    trailingslashit(WP_CONTENT_DIR).'upgrade-temp-backup/plugins',
  ];

  foreach ($roots as $root) {
    if ( ! is_dir($root) ) continue;

    // direct match
    $direct = trailingslashit($root) . $slug;
    if ( is_dir($direct) ) {
      $src = $direct;
    } else {
      // nested: <root>/<random>/[maybe slug or slug-prefixed]
      $src = null;
      foreach (glob(trailingslashit($root).'*', GLOB_ONLYDIR) as $cand) {
        // exact child or slug-prefixed child (e.g., akismet-20250818-123456)
        if ( basename($cand) === $slug || str_starts_with(basename($cand), $slug.'-') ) {
          $src = $cand;
          break;
        }
        // or a nested child named slug
        if ( is_dir(trailingslashit($cand).$slug) ) {
          $src = trailingslashit($cand).$slug;
          break;
        }
      }
      if ( ! $src ) continue;
    }

    $dest = WP_PLUGIN_DIR . '/' . $slug;
    WP_Filesystem(); global $wp_filesystem;
    if ( $wp_filesystem->exists($dest) ) $wp_filesystem->delete($dest, true);

    $ok = copy_dir($src, $dest);
    if ( ! is_wp_error($ok) ) return true;
  }
  return false;
}


/* Auto-rescue when core upgrader reports an error */
add_filter('upgrader_install_package_result', function($result, $hook_extra){
  if ( isset($hook_extra['type']) && $hook_extra['type']==='plugin' && is_wp_error($result) ) {
    $slug = ! empty($hook_extra['plugin']) ? dirname($hook_extra['plugin']) : '';
    if ( $slug && nh_rescue_plugin_if_stuck($slug) ) {
      return ['rescued'=>true,'slug'=>$slug,'from'=>'rollback/upgrade'];
    }
  }
  return $result;
}, 10, 2);

/* After install: verify destination; if missing, rollback from backup */
global $nh_plugin_backups;
$nh_plugin_backups = [];

add_filter('upgrader_pre_install', function($true, $hook_extra){
  if ( isset($hook_extra['type']) && $hook_extra['type'] === 'plugin' && ! empty($hook_extra['plugin']) ) {
    $pf = $hook_extra['plugin'];
    $backup = nh_backup_plugin_dir($pf);
    $GLOBALS['nh_plugin_backups'][$pf] = $backup;
  }
  return $true;
}, 10, 2);

add_filter('upgrader_post_install', function($true, $hook_extra, $result){
  if ( isset($hook_extra['type']) && $hook_extra['type'] === 'plugin' && ! empty($hook_extra['plugin']) ) {
    $pf   = $hook_extra['plugin'];
    $slug = dirname($pf);
    $dest = WP_PLUGIN_DIR . '/' . $slug;

    if ( ! is_dir($dest) ) {
      // try rescue; if still missing, rollback
      if ( ! nh_rescue_plugin_if_stuck($slug) ) {
        $backup = $GLOBALS['nh_plugin_backups'][$pf] ?? null;
        if ( is_string($backup) ) nh_restore_plugin_backup($backup, $pf);
        return new WP_Error('nh_restore', 'Install failed; restored previous version for '.$pf);
      }
    }
  }
  return $true;
}, 10, 3);

/* Flush plugins cache after any plugin process completes */
add_action('upgrader_process_complete', function($upgrader, $hook_extra){
  if ( ! empty($hook_extra['type']) && $hook_extra['type'] === 'plugin' ) {
    delete_site_transient('update_plugins');
    if ( function_exists('wp_clean_plugins_cache') ) wp_clean_plugins_cache(true);
  }
}, 10, 2);

/* =========================================================================
   STATUS: /wp-json/site/v1/status   (with robust core latest)
   ========================================================================= */
add_action('rest_api_init', function () {
  register_rest_route('site/v1', '/status', [
    'methods'             => 'GET',
    'permission_callback' => '__return_true',
    'callback'            => function () {

      // Refresh transients similar to wp-admin
      wp_version_check();
      wp_update_plugins();
      wp_update_themes();

      // ----- Core latest via get_core_updates -----
      require_once ABSPATH . 'wp-includes/version.php';
      $installed = $GLOBALS['wp_version'];
      delete_site_transient('update_core');
      wp_version_check();

      $offers = get_core_updates();
      $latest = $installed; $has_upgrade = false;
      if (is_array($offers) && !empty($offers)) {
        foreach ($offers as $o) {
          $ver = $o->current ?? ($o->version ?? null);
          if ($ver && version_compare($ver, $latest, '>')) $latest = $ver;
          if (($o->response ?? '') === 'upgrade') $has_upgrade = true;
        }
      }
      $core_info = [
        'current_version'  => $installed,
        'latest_version'   => $latest,
        'update_available' => $has_upgrade || version_compare($latest, $installed, '>'),
      ];

      // ----- PHP & MySQL -----
      global $wpdb;
      $php_mysql_info = [
        'php_version'   => phpversion(),
        'mysql_version' => $wpdb->db_version()
      ];

      // ----- Plugins -----
      $all_plugins     = get_plugins();
      $active_plugins  = get_option('active_plugins', []);
      $plugin_updates  = get_plugin_updates();
      $plugin_info     = [];

      foreach ($all_plugins as $plugin_file => $plugin_data) {
        $update = $plugin_updates[$plugin_file] ?? null;
        $plugin_info[] = [
          'plugin_file'      => $plugin_file,
          'slug'             => sanitize_title($plugin_data['Name']),
          'name'             => $plugin_data['Name'],
          'version'          => $plugin_data['Version'],
          'active'           => in_array($plugin_file, $active_plugins, true),
          'update_available' => (bool) $update,
          'latest_version'   => $update->update->new_version ?? $plugin_data['Version'],
        ];
      }

      // ----- Themes -----
      $themes        = wp_get_themes();
      $active_theme  = wp_get_theme();
      $theme_updates = get_theme_updates();
      $theme_info    = [];
      foreach ($themes as $slug => $theme) {
        $update = $theme_updates[$slug] ?? null;
        $theme_info[] = [
          'name'             => $theme->get('Name'),
          'version'          => $theme->get('Version'),
          'active'           => $theme->get_stylesheet() === $active_theme->get_stylesheet(),
          'update_available' => (bool) $update,
          'latest_version'   => $update->update->new_version ?? null,
        ];
      }

      return new WP_REST_Response([
        'core'      => $core_info,
        'php_mysql' => $php_mysql_info,
        'plugins'   => $plugin_info,
        'themes'    => $theme_info,
      ], 200);
    },
  ]);
});

/* =========================================================================
   Helpers to parse incoming plugin list for REST
   ========================================================================= */
function nh_parse_plugins_from_request(WP_REST_Request $request): array {
  $plugins = [];

  // JSON body support
  $raw = $request->get_body();
  if (is_string($raw) && strlen(trim($raw))) {
    $data = json_decode($raw, true);
    if (is_array($data) && array_key_exists('plugins', $data)) {
      if (is_array($data['plugins'])) { $plugins = array_map('strval', $data['plugins']); }
      elseif (is_string($data['plugins'])) { $plugins = preg_split('/\s*,\s*/', $data['plugins'], -1, PREG_SPLIT_NO_EMPTY); }
    }
  }
  // Form body fallback
  if (empty($plugins)) {
    $paramArr = $request->get_param('plugins');
    if (is_array($paramArr)) { $plugins = array_map('strval', $paramArr); }
    elseif (is_string($paramArr) && strlen(trim($paramArr))) { $plugins = preg_split('/\s*,\s*/', $paramArr, -1, PREG_SPLIT_NO_EMPTY); }
  }
  // Final clean
  $plugins = array_values(array_filter(array_map('trim', $plugins), fn($p)=> is_string($p) && $p!==''));
  return $plugins;
}

/* =========================================================================
   /custom/v1/update-plugins  (safe batch updates + mutex lock)
   ========================================================================= */
add_action('rest_api_init', function () {
  register_rest_route('custom/v1', '/update-plugins', [
    'methods'             => 'POST',
    'permission_callback' => function () { return current_user_can('update_plugins'); },
    'callback'            => function ( WP_REST_Request $request ) {

      // ---- Mutex: prevent overlapping updates from frontend/wp-admin ----
      $lock_key = 'nh_plugins_updating_lock';
      if ( get_transient($lock_key) ) {
        return new WP_REST_Response(['ok'=>false,'error'=>'Another update is in progress'], 409);
      }
      set_transient($lock_key, 1, 15 * MINUTE_IN_SECONDS);

      try {
        // ---- Preflight sanity (writable dirs, zip, curl, free space) ----
        $why = null;
        if ( ! nh_updater_preflight_ok($why) ) {
          return new WP_REST_Response(['ok'=>false, 'error'=>'Preflight failed: '.$why], 500);
        }

        // Direct FS writes (no FTP creds), ensure WP_Filesystem ready
        if (!defined('FS_METHOD')) define('FS_METHOD', 'direct');
        global $wp_filesystem; if (empty($wp_filesystem)) WP_Filesystem();

        // ---- Parse list of plugin files from request ----
        // Accepts: JSON {"plugins":["a/b.php","c/d.php"]}, CSV, or form arrays
        $plugins = nh_parse_plugins_from_request($request);
        if (empty($plugins)) {
          return new WP_REST_Response(['ok'=>false,'error'=>'No plugins provided'], 400);
        }

        // Support {"plugins":"all"} to upgrade only those with updates available
        if (count($plugins) === 1 && strtolower($plugins[0]) === 'all') {
          wp_update_plugins();
          $updates = get_plugin_updates();          // keyed by plugin_file
          $plugins = array_keys($updates);          // only plugins needing updates
          if (empty($plugins)) {
            return new WP_REST_Response(['ok'=>true,'results'=>[],'post_status'=>[]], 200);
          }
        }

        // Refresh update transients before starting
        wp_update_plugins();

        // Quiet skin that captures feedback/errors
        $skin = new class extends WP_Upgrader_Skin {
          public array $messages = [];
          public function header() {}
          public function footer() {}
          public function before() {}
          public function after() {}
          public function error($e) { $this->messages[] = is_wp_error($e) ? $e->get_error_message() : (string)$e; }
          public function feedback($s, ...$a) { if (is_string($s)) $this->messages[] = vsprintf($s, (array)$a); }
          public function get_upgrade_messages(){ return $this->messages; }
        };

        $upgrader = new Plugin_Upgrader($skin);
        $results  = [];

        foreach ($plugins as $pf) {
          $pf = trim($pf);
          if ($pf === '') continue;

          // Best-effort backup of current plugin directory
          $backup = nh_backup_plugin_dir($pf);

          // Run the upgrade (returns bool|array|WP_Error)
          $res = $upgrader->upgrade($pf);
          $ok  = ($res === true) || (is_array($res) && empty($res['error']));

          // If failed, try rescuing from upgrade/rollback temp folders
          if ( ! $ok ) {
            $slug = dirname($pf);
            if ( nh_rescue_plugin_if_stuck($slug) ) {
              $ok = true;
            }
          }

          // Verify destination exists; if missing, attempt rollback from backup
          $dest_dir = WP_PLUGIN_DIR . '/' . dirname($pf);
          if ( ! $ok || ! is_dir($dest_dir) ) {
            if ( is_string($backup) ) {
              $rest = nh_restore_plugin_backup($backup, $pf);
              // If restored, we mark as failed update but plugin present
              if ($rest === true) { $ok = false; }
            }
          }

          // Collect messages and outcome for this plugin
          $messages = method_exists($upgrader->skin, 'get_upgrade_messages')
                     ? $upgrader->skin->get_upgrade_messages()
                     : null;

          $results[] = [
            'plugin'   => $pf,
            'ok'       => (bool)$ok,
            'restored' => (!$ok && is_string($backup)),
            'raw'      => is_wp_error($res) ? $res->get_error_message() : (is_array($res) ? $res : (bool)$res),
            'messages' => $messages,
          ];

          // Keep dashboard state fresh during batches
          delete_site_transient('update_plugins');
          if ( function_exists('wp_clean_plugins_cache') ) wp_clean_plugins_cache(true);
        }

        // Report post-update plugin versions
        $post = [];
        foreach ($plugins as $pf) {
          $data = get_plugin_data(WP_PLUGIN_DIR . '/' . $pf, false, false);
          $post[$pf] = [
            'name'    => $data['Name'] ?? null,
            'version' => $data['Version'] ?? null,
          ];
        }

        // Overall success
        $overall_ok = true;
        foreach ($results as $r) { if (empty($r['ok'])) { $overall_ok = false; break; } }

        return new WP_REST_Response([
          'ok'          => $overall_ok,
          'results'     => $results,
          'post_status' => $post,
        ], 200);

      } finally {
        // Always release the lock
        delete_transient($lock_key);
      }
    },
  ]);
});
/* =========================================================================
   /custom/v1/update-core  (unchanged behavior, small tidy)
   ========================================================================= */
add_action('rest_api_init', function () {
  register_rest_route('custom/v1', '/update-core', [
    'methods'             => 'POST',
    'permission_callback' => function () { return current_user_can('update_core'); },
    'callback'            => function ( WP_REST_Request $request ) {

      if (!defined('FS_METHOD')) define('FS_METHOD', 'direct');
      global $wp_filesystem; if (empty($wp_filesystem)) WP_Filesystem();

      delete_option('core_updater.lock');
      delete_site_transient('update_core');
      wp_version_check();

      $offers = get_core_updates();
      if (empty($offers)) return new WP_REST_Response(['message'=>'No core update info available'], 200);

      $candidate = null;
      foreach ($offers as $o) { if (($o->response ?? '') === 'upgrade') { $candidate = $o; break; } }
      if (!$candidate) return new WP_REST_Response(['message'=>'No core update available'], 200);

      // Silent skin
      if (!class_exists('NH_Silent_Upgrader_Skin')) {
        class NH_Silent_Upgrader_Skin extends WP_Upgrader_Skin {
          public function header() {}
          public function footer() {}
          public function feedback($string, ...$args) {}
          public function error($errors) {}
          public function before() {}
          public function after() {}
        }
      }

      try {
        $upgrader = new Core_Upgrader(new NH_Silent_Upgrader_Skin());
        $result   = $upgrader->upgrade($candidate);
      } catch (Throwable $e) {
        return new WP_REST_Response(['error'=>$e->getMessage()], 500);
      }
      if (is_wp_error($result)) return new WP_REST_Response(['error'=>$result->get_error_message()], 500);

      delete_site_transient('update_core');
      return new WP_REST_Response(['message'=>'WordPress core updated successfully'], 200);
    },
  ]);
});

add_action('rest_api_init', function () {
  register_rest_route('custom/v1', '/preflight', [
    'methods'  => 'GET',
    'permission_callback' => '__return_true',
    'callback' => function () {
      $why = null;
      $ok  = nh_updater_preflight_ok($why);
      return new WP_REST_Response([
        'ok'  => (bool) $ok,
        'why' => $ok ? null : (string) $why,
        'dirs' => [
          'upgrade' => [
            'path' => WP_CONTENT_DIR . '/upgrade',
            'exists' => is_dir(WP_CONTENT_DIR . '/upgrade'),
            'writable' => wp_is_writable(WP_CONTENT_DIR . '/upgrade'),
          ],
          'rollback' => [
            'path' => WP_CONTENT_DIR . '/upgrade-temp-backup/plugins',
            'exists' => is_dir(WP_CONTENT_DIR . '/upgrade-temp-backup/plugins'),
            'writable' => wp_is_writable(WP_CONTENT_DIR . '/upgrade-temp-backup/plugins'),
          ],
          'plugins' => [
            'path' => WP_PLUGIN_DIR,
            'exists' => is_dir(WP_PLUGIN_DIR),
            'writable' => wp_is_writable(WP_PLUGIN_DIR),
          ],
        ],
        'zip'  => class_exists('ZipArchive'),
        'curl' => function_exists('curl_init') || (bool) ini_get('allow_url_fopen'),
      ], 200);
    },
  ]);
});



