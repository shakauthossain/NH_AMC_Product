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
          'name' => $plugin_data['Name'],
          'version' => $plugin_data['Version'],
          'active' => in_array($plugin_file, $active_plugins),
          'update_available' => $update ? true : false,
          'latest_version' => $update->update->new_version ?? null
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
class Silent_Skin extends WP_Upgrader_Skin {
    public function header() {}
    public function footer() {}
    public function feedback($string, ...$args) {}
    public function error($errors) {}
    public function before() {}
    public function after() {}
}

function handle_plugin_update_request($request) {
    require_once ABSPATH . 'wp-admin/includes/update.php';
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';

    wp_update_plugins();

    $plugin_data = get_plugins();
    $plugin_slugs = array_keys($plugin_data);

    $skin = new Silent_Skin();
    $upgrader = new Plugin_Upgrader($skin);

    add_filter('enable_maintenance_mode', '__return_false');

    $result = $upgrader->bulk_upgrade($plugin_slugs);

    return new WP_REST_Response([
        'status' => 'plugin update complete',
        'result' => $result
    ], 200);
}
