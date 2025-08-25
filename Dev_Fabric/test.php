<?php

/**
 * Plugin Name: Site Update Endpoints
 * Description: REST endpoints to fetch update status and to update plugins, themes, and core (single vs bulk).
 * Version:     1.0.0
 * Author:      Your Name
 */

if (! defined('ABSPATH')) exit;

// --- Common Includes (load early) ---
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/theme.php';
require_once ABSPATH . 'wp-admin/includes/update.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

//
// -------- Silent Skins (no HTML output) --------
//

class SUE_Silent_Single_Skin extends WP_Upgrader_Skin
{
	public array $messages = [];
	public function header() {}
	public function footer() {}
	public function before() {}
	public function after() {}
	public function feedback($string, ...$args)
	{
		if (is_string($string)) $this->messages[] = vsprintf($string, (array) $args);
	}
	public function error($errors)
	{
		$this->messages[] = is_wp_error($errors) ? $errors->get_error_message() : (string) $errors;
	}
	public function get_messages()
	{
		return $this->messages;
	}
}

class SUE_Silent_Bulk_Plugin_Skin extends Bulk_Plugin_Upgrader_Skin
{
	public array $messages = [];
	public function header() {}
	public function footer() {}
	public function feedback($string, ...$args)
	{
		if (is_string($string)) $this->messages[] = vsprintf($string, (array) $args);
	}
	public function error($errors)
	{
		$this->messages[] = is_wp_error($errors) ? $errors->get_error_message() : (string) $errors;
	}
	public function get_messages()
	{
		return $this->messages;
	}
}

class SUE_Silent_Bulk_Theme_Skin extends Bulk_Theme_Upgrader_Skin
{
	public array $messages = [];
	public function header() {}
	public function footer() {}
	public function feedback($string, ...$args)
	{
		if (is_string($string)) $this->messages[] = vsprintf($string, (array) $args);
	}
	public function error($errors)
	{
		$this->messages[] = is_wp_error($errors) ? $errors->get_error_message() : (string) $errors;
	}
	public function get_messages()
	{
		return $this->messages;
	}
}

class SUE_Silent_Core_Skin extends WP_Upgrader_Skin
{
	public array $messages = [];
	public function header() {}
	public function footer() {}
	public function feedback($string, ...$args) {}
	public function error($errors)
	{
		$this->messages[] = is_wp_error($errors) ? $errors->get_error_message() : (string) $errors;
	}
	public function get_messages()
	{
		return $this->messages;
	}
}

//
// -------- Helpers --------
//

/**
 * Ensure filesystem is ready and use 'direct' where safe.
 */
function sue_prepare_filesystem()
{
	if (! defined('FS_METHOD')) {
		define('FS_METHOD', 'direct');
	}
	global $wp_filesystem;
	if (empty($wp_filesystem)) {
		WP_Filesystem();
	}
}

/**
 * Normalize truthy check for upgrader results.
 *
 * @param mixed $res
 * @return bool
 */
function sue_result_ok($res)
{
	// WP can return true, null (already latest), or an array without 'error'
	if ($res === true || $res === null) return true;
	if (is_array($res) && empty($res['error'])) return true;
	return ! is_wp_error($res) && (bool) $res;
}

//
// -------- STATUS: GET /wp-json/site/v1/status --------
//

add_action('rest_api_init', function () {
	register_rest_route('custom/v1', '/status', [
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function () {
			require_once ABSPATH . 'wp-includes/version.php';

			// Trigger update checks so transients are fresh.
			wp_version_check();
			wp_update_plugins();
			wp_update_themes();

			// Core info
			$core_updates = get_site_transient('update_core');
			$core_info = [
				'current_version'   => $GLOBALS['wp_version'],
				'update_available'  => false,
				'latest_version'    => null,
			];
			if (! empty($core_updates->updates[0]) && $core_updates->updates[0]->response !== 'latest') {
				$core_info['update_available'] = true;
				$core_info['latest_version']   = $core_updates->updates[0]->version;
			}

			// PHP & MySQL
			global $wpdb;
			$php_mysql_info = [
				'php_version'   => phpversion(),
				'mysql_version' => $wpdb->db_version(),
			];

			// Plugins
			$all_plugins    = get_plugins();                // [plugin_file => data]
			$active_plugins = get_option('active_plugins', []);
			$plugin_updates = get_plugin_updates();         // [plugin_file => (obj with ->update->new_version)]
			$plugin_info    = [];

			foreach ($all_plugins as $plugin_file => $plugin_data) {
				$update = $plugin_updates[$plugin_file] ?? null;

				$plugin_info[] = [
					'plugin_file'      => $plugin_file, // e.g. akismet/akismet.php
					'slug'             => sanitize_title($plugin_data['Name']),
					'name'             => $plugin_data['Name'],
					'version'          => $plugin_data['Version'],
					'active'           => in_array($plugin_file, $active_plugins, true),
					'update_available' => (bool) $update,
					'latest_version'   => $update->update->new_version ?? $plugin_data['Version'],
				];
			}

			// Themes
			$themes         = wp_get_themes();             // [stylesheet => WP_Theme]
			$active_theme   = wp_get_theme();
			$theme_updates  = get_theme_updates();         // [stylesheet => (obj->update->new_version)]
			$theme_info     = [];

			foreach ($themes as $stylesheet => $theme) {
				$update = $theme_updates[$stylesheet] ?? null;
				$theme_info[] = [
					'stylesheet'       => $stylesheet,
					'name'             => $theme->get('Name'),
					'version'          => $theme->get('Version'),
					'active'           => ($theme->get_stylesheet() === $active_theme->get_stylesheet()),
					'update_available' => (bool) $update,
					'latest_version'   => $update->update->new_version ?? null,
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

//
// -------- PLUGINS: POST /wp-json/custom/v1/update-plugins --------
//

add_action('rest_api_init', function () {
	register_rest_route('custom/v1', '/update-plugins', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can('update_plugins');
		},
		'callback'            => 'sue_handle_update_plugins',
		'args'                => [
			'plugins' => ['required' => false],
			'mode'    => ['required' => false], // auto|single|bulk
		],
	]);
});

function sue_handle_update_plugins(WP_REST_Request $request)
{
	sue_prepare_filesystem();

	// Refresh available plugin updates
	wp_update_plugins();

	$param_plugins = trim((string) $request->get_param('plugins'));
	$mode          = strtolower((string) ($request->get_param('mode') ?: 'auto'));

	// Build target list of plugin basenames
	$targets = [];
	if ($param_plugins === '' || $param_plugins === 'all') {
		$updates = get_plugin_updates(); // only those with updates
		$targets = array_keys($updates);
	} elseif ($param_plugins === 'all-installed') {
		$targets = array_keys(get_plugins());
	} else {
		$list      = array_filter(array_map('trim', explode(',', $param_plugins)));
		$installed = array_keys(get_plugins());
		$targets   = array_values(array_intersect($list, $installed));
	}

	if (empty($targets)) {
		return new WP_REST_Response([
			'ok'      => true,
			'message' => 'No plugins to update',
			'results' => [],
		], 200);
	}

	if ($mode === 'auto') {
		$mode = (count($targets) > 1) ? 'bulk' : 'single';
	}

	$overall_ok       = true;
	$response_results = [];

	if ($mode === 'single') {
		$plugin_file = $targets[0];
		$skin        = new SUE_Silent_Single_Skin();
		$upgrader    = new Plugin_Upgrader($skin);

		$res = $upgrader->upgrade($plugin_file); // bool|array|WP_Error|null
		$ok  = sue_result_ok($res);
		if (! $ok) $overall_ok = false;

		$response_results[$plugin_file] = [
			'ok'       => $ok,
			'raw'      => is_wp_error($res) ? $res->get_error_message() : (is_array($res) ? $res : (bool) $res),
			'messages' => method_exists($skin, 'get_messages') ? $skin->get_messages() : null,
		];
	} else {
		// BULK – mirrors wp-admin’s "Update Selected"
		$skin     = new SUE_Silent_Bulk_Plugin_Skin(['nonce' => 'bulk-update-plugins']);
		$upgrader = new Plugin_Upgrader($skin);

		$results = $upgrader->bulk_upgrade($targets); // array keyed by plugin_file

		foreach ($targets as $plugin_file) {
			$res = $results[$plugin_file] ?? null;
			$ok  = sue_result_ok($res);
			if (! $ok) $overall_ok = false;

			$response_results[$plugin_file] = [
				'ok'  => $ok,
				'raw' => is_wp_error($res) ? $res->get_error_message() : (is_array($res) ? $res : (bool) $res),
			];
		}

		if (method_exists($skin, 'get_messages')) {
			$response_results['_messages'] = $skin->get_messages();
		}
	}

	// Clean caches
	delete_site_transient('update_plugins');
	if (function_exists('wp_clean_plugins_cache')) wp_clean_plugins_cache(true);

	return new WP_REST_Response([
		'ok'      => $overall_ok,
		'mode'    => $mode,
		'updated' => array_keys(array_filter($response_results, fn($r) => ! isset($r['ok']) || $r['ok'])),
		'results' => $response_results,
	], 200);
}

//
// -------- CORE: POST /wp-json/custom/v1/update-core --------
//

add_action('rest_api_init', function () {
	register_rest_route('custom/v1', '/update-core', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can('update_core');
		},
		'callback'            => 'sue_handle_update_core',
	]);
});

function sue_handle_update_core(WP_REST_Request $request)
{
	sue_prepare_filesystem();

	// Clear any stale core lock
	delete_option('core_updater.lock');

	// Refresh core updates
	wp_version_check();
	$updates = get_site_transient('update_core');

	if (empty($updates->updates) || $updates->updates[0]->response !== 'upgrade') {
		return new WP_REST_Response(['message' => 'No core update available'], 200);
	}

	try {
		$skin     = new SUE_Silent_Core_Skin();
		$upgrader = new Core_Upgrader($skin);
		$result   = $upgrader->upgrade($updates->updates[0]);
	} catch (Throwable $e) {
		return new WP_REST_Response(['error' => $e->getMessage()], 500);
	}

	if (is_wp_error($result)) {
		return new WP_REST_Response(['error' => $result->get_error_message()], 500);
	}

	return new WP_REST_Response(['message' => 'WordPress core updated successfully'], 200);
}

//
// -------- THEMES: POST /wp-json/custom/v1/update-themes --------
//

add_action('rest_api_init', function () {
	register_rest_route('custom/v1', '/update-themes', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can('update_themes');
		},
		'callback'            => 'sue_handle_update_themes',
		'args'                => [
			'themes' => ['required' => false], // "all" | "all-installed" | CSV of stylesheets
			'mode'   => ['required' => false], // auto|single|bulk
		],
	]);
});

function sue_handle_update_themes(WP_REST_Request $request)
{
	sue_prepare_filesystem();

	// Refresh available theme updates
	wp_update_themes();

	$param_themes = trim((string) $request->get_param('themes'));
	$mode         = strtolower((string) ($request->get_param('mode') ?: 'auto'));

	// Build target list of theme stylesheets (keys of wp_get_themes)
	$targets = [];
	if ($param_themes === '' || $param_themes === 'all') {
		$updates = get_theme_updates();             // [stylesheet => obj]
		$targets = array_keys($updates);
	} elseif ($param_themes === 'all-installed') {
		$targets = array_keys(wp_get_themes());   // all stylesheets
	} else {
		$list     = array_filter(array_map('trim', explode(',', $param_themes)));
		$installed = array_keys(wp_get_themes());
		$targets   = array_values(array_intersect($list, $installed));
	}

	if (empty($targets)) {
		return new WP_REST_Response([
			'ok'      => true,
			'message' => 'No themes to update',
			'results' => [],
		], 200);
	}

	if ($mode === 'auto') {
		$mode = (count($targets) > 1) ? 'bulk' : 'single';
	}

	$overall_ok       = true;
	$response_results = [];

	if ($mode === 'single') {
		$stylesheet = $targets[0];
		$skin       = new SUE_Silent_Single_Skin();
		$upgrader   = new Theme_Upgrader($skin);

		$res = $upgrader->upgrade($stylesheet);
		$ok  = sue_result_ok($res);
		if (! $ok) $overall_ok = false;

		$response_results[$stylesheet] = [
			'ok'       => $ok,
			'raw'      => is_wp_error($res) ? $res->get_error_message() : (is_array($res) ? $res : (bool) $res),
			'messages' => method_exists($skin, 'get_messages') ? $skin->get_messages() : null,
		];
	} else {
		$skin     = new SUE_Silent_Bulk_Theme_Skin(['nonce' => 'bulk-update-themes']);
		$upgrader = new Theme_Upgrader($skin);

		$results = $upgrader->bulk_upgrade($targets); // array keyed by stylesheet

		foreach ($targets as $stylesheet) {
			$res = $results[$stylesheet] ?? null;
			$ok  = sue_result_ok($res);
			if (! $ok) $overall_ok = false;

			$response_results[$stylesheet] = [
				'ok'  => $ok,
				'raw' => is_wp_error($res) ? $res->get_error_message() : (is_array($res) ? $res : (bool) $res),
			];
		}

		if (method_exists($skin, 'get_messages')) {
			$response_results['_messages'] = $skin->get_messages();
		}
	}

	// Clean caches
	delete_site_transient('update_themes');
	if (function_exists('wp_clean_themes_cache')) wp_clean_themes_cache(true);

	return new WP_REST_Response([
		'ok'      => $overall_ok,
		'mode'    => $mode,
		'updated' => array_keys(array_filter($response_results, fn($r) => ! isset($r['ok']) || $r['ok'])),
		'results' => $response_results,
	], 200);
}

//
// -------- Example curls (for reference) --------
//
// # Update one plugin exactly (single mode)
// curl -X POST -u admin:admin \
//  -d 'plugins=akismet/akismet.php&mode=single' \
//  https://139.59.102.1/wp-json/custom/v1/update-plugins
//
// # Update everything with available updates (auto -> bulk)
// curl -X POST -u admin:admin \
//  -d 'plugins=all' \
//  https://139.59.102.1/wp-json/custom/v1/update-plugins
//
// # Update specific plugins using native bulk logic
// curl -X POST -u user:app-password \
//  -d 'plugins=akismet/akismet.php,wordpress-seo/wp-seo.php&mode=bulk' \
//  https://139.59.102.1/wp-json/custom/v1/update-plugins
//
// # Update one theme (by stylesheet directory name)
// curl -X POST -u user:app-password \
//  -d 'themes=twentytwentyfive&mode=single' \
//  https://139.59.102.1/wp-json/custom/v1/update-themes
//
// # Update all themes with updates (bulk)
// curl -X POST -u user:app-password \
//  -d 'themes=all' \
//  https://139.59.102.1/wp-json/custom/v1/update-themes
//
// # Update core
// curl -X POST -u user:app-password https://139.59.102.1/wp-json/custom/v1/update-core
//