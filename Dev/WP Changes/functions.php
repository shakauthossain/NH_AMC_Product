<?php

/**

This one is the main functions.php of the activated theme.

 **/

//Fetching Outdate Informations
add_action('rest_api_init', function () {
  register_rest_route('site/v1', '/status', [
    'methods' => 'GET',
    'callback' => function () {
      require_once ABSPATH . 'wp-admin/includes/plugin.php';
      require_once ABSPATH . 'wp-admin/includes/theme.php';
      require_once ABSPATH . 'wp-admin/includes/update.php';
      require_once ABSPATH . 'wp-includes/version.php';

      // Trigger updates
      wp_version_check();
      wp_update_plugins();
      wp_update_themes();

      // Core info
      $core_updates = get_site_transient('update_core');
      $core_info = [
        'current_version' => $GLOBALS['wp_version'],
        'update_available' => false,
        'latest_version' => null
      ];
      if (!empty($core_updates->updates[0]) && $core_updates->updates[0]->response !== 'latest') {
        $core_info['update_available'] = true;
        $core_info['latest_version'] = $core_updates->updates[0]->version;
      }

      // PHP & MySQL
      global $wpdb;
      $php_mysql_info = [
        'php_version' => phpversion(),
        'mysql_version' => $wpdb->db_version()
      ];

      // Plugins
      $all_plugins = get_plugins();
      $active_plugins = get_option('active_plugins', []);
      $plugin_updates = get_plugin_updates();
      $plugin_info = [];

      foreach ($all_plugins as $plugin_file => $plugin_data) {
        $update = $plugin_updates[$plugin_file] ?? null;

        $plugin_info[] = [
          'plugin_file'     => $plugin_file,                 // e.g. 'akismet/akismet.php'
          'slug'            => sanitize_title($plugin_data['Name']), // optional string-safe slug
          'name'            => $plugin_data['Name'],
          'version'         => $plugin_data['Version'],
          'active'          => in_array($plugin_file, $active_plugins),
          'update_available' => (bool) $update,
          'latest_version'  => $update->update->new_version ?? $plugin_data['Version'],
        ];
      }


      // Themes
      $themes = wp_get_themes();
      $active_theme = wp_get_theme();
      $theme_updates = get_theme_updates();
      $theme_info = [];
      foreach ($themes as $slug => $theme) {
        $update = $theme_updates[$slug] ?? null;
        $theme_info[] = [
          'name' => $theme->get('Name'),
          'version' => $theme->get('Version'),
          'active' => $theme->get_stylesheet() === $active_theme->get_stylesheet(),
          'update_available' => $update ? true : false,
          'latest_version' => $update->update->new_version ?? null
        ];
      }

      return [
        'core' => $core_info,
        'php_mysql' => $php_mysql_info,
        'plugins' => $plugin_info,
        'themes' => $theme_info
      ];
    },
    'permission_callback' => '__return_true',
  ]);
});

// Custom REST API to update core, plugins, and themes
// Custom REST API to update core, plugins, and themes
add_action('rest_api_init', function () {
  register_rest_route('custom/v1', '/update-plugins', [
    'methods' => 'POST',
    'callback' => 'handle_plugin_update_request',
    'permission_callback' => function () {
      return current_user_can('update_plugins');
    },
  ]);
});

// ✅ ADD THIS LINE — ensures WP_Upgrader_Skin is defined early
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

// Safe skin: disables all output that would normally be used in wp-admin
class Silent_Skin extends WP_Upgrader_Skin
{
  public function header() {}
  public function footer() {}
  public function feedback($string, ...$args) {}
  public function error($errors) {}
  public function before() {}
  public function after() {}
}

function handle_plugin_update_request($request)
{
  require_once ABSPATH . 'wp-admin/includes/plugin.php';
  require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
  require_once ABSPATH . 'wp-admin/includes/file.php';
  WP_Filesystem();

  $plugin_files = explode(',', $request->get_param('plugins'));  // plugin_file values
  $all_plugins = get_plugins();
  $results = [];

  $skin = new class extends WP_Upgrader_Skin {
    public function feedback($string, ...$args) {}
  };

  $upgrader = new Plugin_Upgrader($skin);

  foreach ($all_plugins as $file => $data) {
    if (in_array($file, $plugin_files, true)) {
      $results[$file] = $upgrader->upgrade($file);
    }
  }

  return new WP_REST_Response([
    'status' => 'plugin update complete',
    'result' => $results
  ]);
}

add_action('rest_api_init', function () {
  register_rest_route('custom/v1', '/update-core', [
    'methods'  => 'POST',
    'callback' => 'custom_update_wp_core',
    'permission_callback' => function () {
      return current_user_can('update_core');
    },
  ]);
});

function custom_update_wp_core(WP_REST_Request $request)
{
  require_once ABSPATH . 'wp-admin/includes/update.php';
  require_once ABSPATH . 'wp-admin/includes/file.php';
  require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

  // Silent skin definition
  if (!class_exists('Silent_Upgrader_Skin')) {
    class Silent_Upgrader_Skin extends WP_Upgrader_Skin
    {
      public function header() {}
      public function footer() {}
      public function feedback($string, ...$args) {}
      public function error($errors) {}
      public function before() {}
      public function after() {}
    }
  }

  // Set FS_METHOD to direct
  if (!defined('FS_METHOD')) {
    define('FS_METHOD', 'direct');
  }

  global $wp_filesystem;
  if (empty($wp_filesystem)) {
    WP_Filesystem();
  }

  // Optional: Remove any stale update lock
  delete_option('core_updater.lock');

  wp_version_check();
  $updates = get_site_transient('update_core');

  if (empty($updates->updates) || $updates->updates[0]->response !== 'upgrade') {
    return new WP_REST_Response(['message' => 'No core update available'], 200);
  }

  try {
    $skin = new Silent_Upgrader_Skin();
    $upgrader = new Core_Upgrader($skin);
    $result = $upgrader->upgrade($updates->updates[0]);
  } catch (Throwable $e) {
    return new WP_REST_Response(['error' => $e->getMessage()], 500);
  }

  if (is_wp_error($result)) {
    return new WP_REST_Response(['error' => $result->get_error_message()], 500);
  }

  return new WP_REST_Response(['message' => 'WordPress core updated successfully'], 200);
}
