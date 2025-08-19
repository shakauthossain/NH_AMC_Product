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

function handle_plugin_update_request(WP_REST_Request $request)
{
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
	require_once ABSPATH . 'wp-admin/includes/file.php';

	// Prefer direct FS + make sure FS is ready
	if (! defined('FS_METHOD')) define('FS_METHOD', 'direct');
	WP_Filesystem();

	// Refresh update info
	wp_update_plugins();

	// Parse input
	$param = trim((string)$request->get_param('plugins'));
	$targets = [];

	if ($param === '' || strtolower($param) === 'all') {
		// Only those with updates available
		$updates = get_plugin_updates();          // keyed by plugin_file
		$targets = array_keys($updates);
	} elseif (strtolower($param) === 'all-installed') {
		// Every installed plugin (even if already latest)
		$all = array_keys(get_plugins());
		$targets = $all;
	} else {
		// CSV list of plugin_file values
		$list = array_filter(array_map('trim', explode(',', $param)));
		// Whitelist against installed plugins
		$installed = array_keys(get_plugins());
		$targets = array_values(array_intersect($list, $installed));
	}

	if (empty($targets)) {
		return new WP_REST_Response([
			'ok' => true,
			'message' => 'No plugins to update',
			'results' => [],
		], 200);
	}

	// Quiet skin that suppresses output
	$skin = new class extends WP_Upgrader_Skin {
		public array $messages = [];
		public function header() {}
		public function footer() {}
		public function before() {}
		public function after() {}
		public function error($e)
		{
			$this->messages[] = is_wp_error($e) ? $e->get_error_message() : (string)$e;
		}
		public function feedback($s, ...$a)
		{
			if (is_string($s)) $this->messages[] = vsprintf($s, (array)$a);
		}
		public function get_messages()
		{
			return $this->messages;
		}
	};

	$upgrader = new Plugin_Upgrader($skin);
	$results  = [];
	$overall_ok = true;

	foreach ($targets as $plugin_file) {
		$res = $upgrader->upgrade($plugin_file); // bool|array|WP_Error
		$ok  = ($res === true) || (is_array($res) && empty($res['error'])) || ($res === null); // WP may return null if already latest
		if (!$ok) $overall_ok = false;

		$results[$plugin_file] = [
			'ok'       => $ok,
			'raw'      => is_wp_error($res) ? $res->get_error_message() : (is_array($res) ? $res : (bool)$res),
			'messages' => method_exists($upgrader->skin, 'get_messages') ? $upgrader->skin->get_messages() : null,
		];
	}

	// Clean caches so wp-admin shows fresh state
	delete_site_transient('update_plugins');
	if (function_exists('wp_clean_plugins_cache')) wp_clean_plugins_cache(true);

	return new WP_REST_Response([
		'ok'      => $overall_ok,
		'updated' => array_keys($results),
		'results' => $results,
	], 200);
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
