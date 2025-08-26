<?php

/**
 * Plugin Name: Remote Plugin Updater
 * Description: Secure REST endpoints to (1) get update status for Core, Plugins, Themes, and (2) trigger single/bulk plugin updates from a terminal. Includes per-plugin transactional updates with backup and rollback.
 * Version:     1.6.0
 * Author:      Notionhive
 */

if (! defined('ABSPATH')) {
    exit;
}

if (! function_exists('is_plugin_active')) {
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
}

/*
|--------------------------------------------------------------------------
| REST ROUTES
|--------------------------------------------------------------------------
*/
add_action('rest_api_init', function () {

    // 1) STATUS: GET /wp-json/custom/v1/status
    register_rest_route('custom/v1', '/status', [
        'methods'  => 'GET',
        'callback' => 'rpu_handle_status',
        'permission_callback' => function () {
            return is_user_logged_in();
        },
    ]);

    // 2) UPDATE PLUGINS: POST /wp-json/custom/v1/update-plugins
    register_rest_route('custom/v1', '/update-plugins', [
        'methods'  => 'POST',
        'callback' => 'rpu_handle_update_plugins',
        'permission_callback' => function () {
            return current_user_can('update_plugins');
        },
    ]);
});

/*
|--------------------------------------------------------------------------
| STATUS HANDLER (hard refresh + WP.org sanity)
|--------------------------------------------------------------------------
*/
function rpu_handle_status(WP_REST_Request $req)
{
    global $wpdb;

    require_once ABSPATH . 'wp-admin/includes/update.php';
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    require_once ABSPATH . 'wp-admin/includes/plugin-install.php'; // plugins_api
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/theme.php';

    // Hard refresh global state
    if (function_exists('wp_clean_update_cache')) {
        wp_clean_update_cache();
    }
    delete_site_transient('update_core');
    delete_site_transient('update_plugins');
    delete_site_transient('update_themes');

    wp_version_check();
    wp_update_plugins();
    wp_update_themes();

    // ---------------- Core ----------------
    $installed        = get_bloginfo('version');
    $core_tr          = get_site_transient('update_core');
    $core_updates_arr = [];

    if (is_object($core_tr) && !empty($core_tr->updates) && is_array($core_tr->updates)) {
        foreach ($core_tr->updates as $u) {
            // WP tends to use "current" for the version, but some contexts expose "version"
            $ver = '';
            if (is_object($u)) {
                $ver = isset($u->current) ? $u->current : (isset($u->version) ? $u->version : '');
                $core_updates_arr[] = [
                    'version'      => $ver,
                    'response'     => isset($u->response) ? $u->response : '',
                    'locale'       => isset($u->locale) ? $u->locale : '',
                    'php_version'  => isset($u->php_version) ? $u->php_version : null,
                ];
            } elseif (is_array($u)) {
                $ver = isset($u['current']) ? $u['current'] : (isset($u['version']) ? $u['version'] : '');
                $core_updates_arr[] = [
                    'version'      => $ver,
                    'response'     => isset($u['response']) ? $u['response'] : '',
                    'locale'       => isset($u['locale']) ? $u['locale'] : '',
                    'php_version'  => isset($u['php_version']) ? $u['php_version'] : null,
                ];
            }
        }
    }

    // Decide available version (ignore entries with response="latest")
    $available_version = $installed;
    foreach ($core_updates_arr as $u) {
        $resp = strtolower($u['response'] ?? '');
        $ver  = $u['version'] ?? '';
        if ($ver && $resp !== 'latest' && version_compare($ver, $available_version, '>')) {
            $available_version = $ver;
        }
    }

    $core_payload = [
        'installed'     => $installed,
        'updates'       => $core_updates_arr,
        'available'     => $available_version,                       // convenience
        'has_update'    => version_compare($available_version, $installed, '>'),
        'php_version'   => PHP_VERSION,                               // actual server PHP
        'mysql_version' => method_exists($wpdb, 'db_version') ? $wpdb->db_version() : null, // actual DB version
    ];

    // ---------------- Plugins ----------------
    $plugins_all = function_exists('get_plugins') ? get_plugins() : [];
    $up_tr       = get_site_transient('update_plugins');
    if (! is_object($up_tr)) {
        $up_tr = (object)['response' => []];
    }

    $active_plugins  = (array) get_option('active_plugins', []);
    $network_actives = is_multisite()
        ? array_keys((array) get_site_option('active_sitewide_plugins', []))
        : [];

    $plugins_list  = [];
    $needs_count   = 0;

    foreach ($plugins_all as $plugin_file => $data) {
        $slug      = dirname($plugin_file);
        $installed = isset($data['Version']) ? $data['Version'] : '';
        $update    = isset($up_tr->response[$plugin_file]) ? $up_tr->response[$plugin_file] : null;
        $available = $installed;
        if (is_object($update) && !empty($update->new_version)) {
            $available = $update->new_version;
        }
        $has_up = version_compare($available, $installed, '>');
        if ($has_up) {
            $needs_count++;
        }

        // active: site or network
        $basename  = plugin_basename($plugin_file);
        $is_active = in_array($plugin_file, $active_plugins, true)
            || in_array($basename, $active_plugins, true)      // defensive
            || in_array($plugin_file, $network_actives, true)
            || in_array($basename, $network_actives, true);

        $plugins_list[] = [
            'file'       => $plugin_file,
            'slug'       => $slug,
            'name'       => isset($data['Name']) ? $data['Name'] : $slug,
            'installed'  => $installed,
            'available'  => $available,
            'has_update' => (bool) $has_up,
            'active'     => (bool) $is_active, // ← NEW
        ];
    }

    usort($plugins_list, fn($a, $b) => strcmp($a['slug'], $b['slug']));
    $plugins_payload = [
        'summary' => ['total' => count($plugins_all), 'update_available' => $needs_count],
        'list'    => $plugins_list,
    ];

    // ---------------- Themes ----------------
    $themes_all   = wp_get_themes();
    $ut_themes    = get_site_transient('update_themes');
    $themes_list  = [];
    $themes_count = 0;

    foreach ($themes_all as $stylesheet => $theme_obj) {
        $name       = $theme_obj->get('Name') ?: $stylesheet;
        $installed  = $theme_obj->get('Version');
        $has_update = (is_object($ut_themes) && isset($ut_themes->response[$stylesheet]));
        $available  = $has_update
            ? ($ut_themes->response[$stylesheet]['new_version'] ?? $installed)
            : $installed;

        if ($has_update) {
            $themes_count++;
        }

        $themes_list[] = [
            'stylesheet' => $stylesheet,
            'name'       => $name,
            'installed'  => $installed,
            'available'  => $available,
            'has_update' => (bool) $has_update,
        ];
    }

    usort($themes_list, fn($a, $b) => strcmp($a['stylesheet'], $b['stylesheet']));
    $themes_payload = [
        'summary' => ['total' => count($themes_all), 'update_available' => $themes_count],
        'list'    => $themes_list,
    ];

    return new WP_REST_Response([
        'ok'      => true,
        'core'    => $core_payload,
        'plugins' => $plugins_payload,
        'themes'  => $themes_payload,
    ], 200);
}

/*
|--------------------------------------------------------------------------
| UPDATE HANDLER (supports transactional per-plugin pipeline)
|--------------------------------------------------------------------------
| Request body (JSON):
| {
|   "plugins": ["akismet","litespeed-cache"],
|   "transactional": true,          // default true
|   "backup": true,                 // default true
|   "health_check": true,           // default true (loopback GET /?rpu-health=1)
|   "reactivate_after": true,       // default true
|   "dry_run": false
| }
*/
function rpu_handle_update_plugins(WP_REST_Request $req)
{
    $body = $req->get_json_params();
    if (!is_array($body)) {
        $body = [];
    }

    $plugins          = isset($body['plugins']) ? (array)$body['plugins'] : [];
    $dry_run          = !empty($body['dry_run']);
    $pre_deactivate   = isset($body['pre_deactivate']) ? (bool)$body['pre_deactivate'] : false;
    $reactivate_after = array_key_exists('reactivate_after', $body) ? (bool)$body['reactivate_after'] : true;
    $transactional    = array_key_exists('transactional', $body) ? (bool)$body['transactional'] : true;
    $do_backup        = array_key_exists('backup', $body) ? (bool)$body['backup'] : true;
    $do_health        = array_key_exists('health_check', $body) ? (bool)$body['health_check'] : true;
    $timeout_sec      = isset($body['timeout_sec']) ? max(5, intval($body['timeout_sec'])) : 45;
    $idempo           = isset($body['idempotency_key']) ? sanitize_text_field($body['idempotency_key']) : '';

    if (empty($plugins)) {
        return new WP_REST_Response(['ok' => false, 'error' => 'no_plugins_provided', 'message' => 'Provide plugins as slugs or plugin files.'], 400);
    }

    $mode = (count($plugins) === 1) ? 'single' : 'bulk';
    if (!empty($body['mode']) && in_array($body['mode'], ['single', 'bulk'], true)) {
        $mode = $body['mode'];
    }

    // Concurrency lock
    $lock_key = 'rpu_lock';
    if (get_transient($lock_key)) {
        return new WP_REST_Response(['ok' => false, 'error' => 'in_progress', 'message' => 'Another update batch is running. Try again soon.'], 409);
    }
    set_transient($lock_key, time(), 10 * MINUTE_IN_SECONDS);

    // Idempotency
    $idem_key  = $idempo ? 'rpu_idempo_' . md5($idempo) : '';
    if ($idem_key) {
        $prev = get_transient($idem_key);
        if ($prev) {
            delete_transient($lock_key);
            return new WP_REST_Response($prev, 200);
        }
    }

    // Deps
    if (! function_exists('get_plugins')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
    require_once ABSPATH . 'wp-admin/includes/update.php';
    require_once ABSPATH . 'wp-admin/includes/plugin-install.php';

    // Normalize identifiers to plugin files
    $all            = get_plugins();
    $file_by_slug   = rpu_map_slug_to_file($all);
    $requested_files = [];
    foreach ($plugins as $p) {
        $p = trim((string)$p);
        if (isset($all[$p])) {
            $requested_files[] = $p;
        } elseif (isset($file_by_slug[$p])) {
            $requested_files[] = $file_by_slug[$p];
        } else {
            $requested_files[] = $p;
        }
    }
    $requested_files = array_values(array_unique($requested_files));

    // Filesystem ready?
    $fs_ready = rpu_init_filesystem();
    if (is_wp_error($fs_ready)) {
        delete_transient($lock_key);
        return new WP_REST_Response(['ok' => false, 'error' => 'filesystem_unavailable', 'message' => $fs_ready->get_error_message()], 500);
    }

    // Always start with fresh metadata
    rpu_global_refresh_updates();

    // Plan (dry run)
    $plan = [];
    foreach ($requested_files as $file) {
        $plan[$file] = rpu_plan_for($file, $all);
    }
    if ($dry_run) {
        $resp = ['ok' => true, 'mode' => $mode, 'dry_run' => true, 'results' => $plan];
        if ($idem_key) {
            set_transient($idem_key, $resp, 15 * MINUTE_IN_SECONDS);
        }
        delete_transient($lock_key);
        return new WP_REST_Response($resp, 200);
    }

    $results = [];
    $updated = [];

    // Execute one-by-one, each in its own transaction
    foreach ($requested_files as $file) {
        $res = rpu_update_one_plugin_transactional($file, [
            'pre_deactivate'   => $pre_deactivate,
            'reactivate_after' => $reactivate_after,
            'backup'           => $do_backup,
            'health_check'     => $do_health,
            'timeout_sec'      => $timeout_sec,
        ]);
        $results[$file] = $res;
        if (!empty($res['ok']) && isset($res['action']) && $res['action'] === 'updated') {
            $updated[] = $file;
        }

        // Refresh metadata between items so next plugin gets fresh info
        rpu_global_refresh_updates();
    }

    // Finalize (start next call clean)
    delete_site_transient('update_plugins');
    delete_transient($lock_key);

    $resp = ['ok' => true, 'mode' => $mode, 'updated' => $updated, 'results' => $results, 'plan' => $plan];
    if ($idem_key) {
        set_transient($idem_key, $resp, 15 * MINUTE_IN_SECONDS);
    }
    return new WP_REST_Response($resp, 200);
}

/*
|--------------------------------------------------------------------------
| TRANSACTIONAL UPDATE (download → unpack → backup → stage/swap → reactivate → cleanup)
|--------------------------------------------------------------------------
*/
function rpu_update_one_plugin_transactional($file, array $opts): array
{
    $defaults = [
        'pre_deactivate'   => false,
        'reactivate_after' => true,
        'backup'           => true,
        'health_check'     => true,
        'timeout_sec'      => 45,
    ];
    $o = array_merge($defaults, $opts);

    if (! function_exists('get_plugins')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    $all = get_plugins();
    if (! isset($all[$file])) {
        return ['ok' => false, 'action' => 'not_found', 'messages' => ['Plugin not installed.']];
    }

    $slug       = explode('/', $file)[0];
    $plugin_dir = WP_PLUGIN_DIR . '/' . dirname($file);
    $was_active = is_plugin_active($file) || (function_exists('is_plugin_active_for_network') && is_plugin_active_for_network($file));
    $from_ver   = $all[$file]['Version'] ?? null;

    // 1) Decide package (from transient or wp.org)
    $pkg = rpu_package_for_plugin($file, $slug);
    if (! $pkg) {
        return ['ok' => true, 'action' => 'up_to_date', 'from' => $from_ver, 'to' => $from_ver, 'messages' => ['No update available.']];
    }

    // 2) Download
    $tmp_zip = download_url($pkg, $o['timeout_sec']);
    if (is_wp_error($tmp_zip)) {
        return ['ok' => false, 'action' => 'download_error', 'from' => $from_ver, 'to' => null, 'messages' => ['Download failed: ' . $tmp_zip->get_error_message()]];
    }

    // Ensure temp workspace
    $work_base = WP_CONTENT_DIR . '/upgrade/rpu-' . $slug . '-' . time() . '-' . wp_generate_password(6, false, false);
    $unpack_to = $work_base . '/unpacked';
    $stage_to  = $work_base . '/stage';
    wp_mkdir_p($unpack_to);
    wp_mkdir_p($stage_to);

    // 3) Unpack
    $unz = unzip_file($tmp_zip, $unpack_to);
    @unlink($tmp_zip);
    if (is_wp_error($unz)) {
        rpu_rrmdir($work_base);
        return ['ok' => false, 'action' => 'unzip_error', 'from' => $from_ver, 'to' => null, 'messages' => ['Unzip failed: ' . $unz->get_error_message()]];
    }

    // 4) Normalize source root (find actual folder with plugin files)
    $src_root = rpu_find_single_dir($unpack_to);
    if (! $src_root) {
        $src_root = $unpack_to;
    }

    // 5) Stage: copy new version into staging dir with final target name
    $target_dir_name = basename($plugin_dir); // intended folder name
    $staged_dir      = $stage_to . '/' . $target_dir_name;
    $copy_res        = rpu_copy_dir($src_root, $staged_dir);
    if (is_wp_error($copy_res)) {
        rpu_rrmdir($work_base);
        return ['ok' => false, 'action' => 'copy_error', 'from' => $from_ver, 'to' => null, 'messages' => ['Copy to staging failed: ' . $copy_res->get_error_message()]];
    }

    // 6) Optional: deactivate
    if ($o['pre_deactivate'] && $was_active) {
        deactivate_plugins([$file], true);
    }

    // 7) Backup current folder (move to backups dir)
    $backup_dir = null;
    if ($o['backup']) {
        $backup_root = WP_CONTENT_DIR . '/upgrade/rpu-backups';
        wp_mkdir_p($backup_root);
        $backup_dir = $backup_root . '/' . $target_dir_name . '-' . date('Ymd-His');
        $mv = rpu_move_dir($plugin_dir, $backup_dir);
        if (is_wp_error($mv)) {
            rpu_rrmdir($work_base);
            // Try to reactivate if we deactivated earlier
            if ($o['pre_deactivate'] && $was_active && $o['reactivate_after']) {
                @activate_plugin($file, '', is_multisite());
            }
            return ['ok' => false, 'action' => 'backup_error', 'from' => $from_ver, 'to' => null, 'messages' => ['Backup failed: ' . $mv->get_error_message()]];
        }
        // Ensure target path is free for swap-in (may have been moved already)
        @rpu_rrmdir($plugin_dir);
    } else {
        // No backup: remove target folder (we staged safely above)
        rpu_rrmdir($plugin_dir);
    }

    // 8) Atomic-ish swap: move staged folder into final location
    $swap = rpu_move_dir($staged_dir, $plugin_dir);
    if (is_wp_error($swap)) {
        // Rollback from backup
        if ($backup_dir && is_dir($backup_dir)) {
            @rpu_rrmdir($plugin_dir); // cleanup partial
            rpu_move_dir($backup_dir, $plugin_dir);
        }
        rpu_rrmdir($work_base);
        if ($o['pre_deactivate'] && $was_active && $o['reactivate_after']) {
            @activate_plugin($file, '', is_multisite());
        }
        return ['ok' => false, 'action' => 'swap_error', 'from' => $from_ver, 'to' => null, 'messages' => ['Install failed while swapping in new files. Rolled back.']];
    }

    // 9) Health check (simple loopback GET), rollback if fails
    $health_ok = true;
    $health_msg = 'OK';
    if ($o['health_check']) {
        $health = wp_remote_get(home_url('/?rpu-health=1'), ['timeout' => 10]);
        if (is_wp_error($health) || wp_remote_retrieve_response_code($health) >= 500) {
            $health_ok = false;
            $health_msg = is_wp_error($health) ? $health->get_error_message() : 'HTTP ' . wp_remote_retrieve_response_code($health);
        }
    }
    if (! $health_ok) {
        // Rollback
        if ($backup_dir && is_dir($backup_dir)) {
            @rpu_rrmdir($plugin_dir);
            rpu_move_dir($backup_dir, $plugin_dir);
        }
        rpu_rrmdir($work_base);
        if ($o['pre_deactivate'] && $was_active && $o['reactivate_after']) {
            @activate_plugin($file, '', is_multisite());
        }
        return ['ok' => false, 'action' => 'health_check_failed', 'from' => $from_ver, 'to' => null, 'messages' => ['Health check failed: ' . $health_msg . '. Restored previous version.']];
    }

    // 10) Reactivate if needed
    $to_ver = rpu_get_plugin_version_now($file); // refreshes cache
    if ($o['reactivate_after'] && $was_active) {
        $act_res = activate_plugin($file, '', is_multisite());
        if (is_wp_error($act_res)) {
            // Attempt rollback if activation fatal? (Optional; we keep new code but report)
            rpu_rrmdir($work_base);
            return ['ok' => false, 'action' => 'reactivation_failed', 'from' => $from_ver, 'to' => $to_ver, 'messages' => ['Updated but failed to reactivate: ' . $act_res->get_error_message()]];
        }
    }

    // 11) Cleanup
    // Keep backup by default (safest). If you prefer auto-delete, change here.
    rpu_rrmdir($work_base);

    return ['ok' => true, 'action' => 'updated', 'from' => $from_ver, 'to' => $to_ver, 'messages' => ['Update completed (transactional).']];
}

/*
|--------------------------------------------------------------------------
| PLANNING & METADATA HELPERS
|--------------------------------------------------------------------------
*/
function rpu_plan_for($file, $all): array
{
    if (! isset($all[$file])) {
        return ['ok' => false, 'action' => 'not_found', 'messages' => ['Plugin not installed or invalid identifier.']];
    }
    $cur_ver = $all[$file]['Version'] ?? null;
    $slug    = explode('/', $file)[0];
    $trans   = get_site_transient('update_plugins');
    $has_up  = isset($trans->response[$file]);
    $new_ver = $has_up ? ($trans->response[$file]->new_version ?? null) : null;

    if (! $has_up) {
        $latest = rpu_wporg_latest_version($slug);
        if ($latest && $cur_ver && version_compare($cur_ver, $latest, '<')) {
            return ['ok' => true, 'action' => 'would_update', 'from' => $cur_ver, 'to' => $latest, 'package' => 'wporg', 'messages' => ['New version detected via WP.org']];
        }
        return ['ok' => true, 'action' => 'up_to_date', 'from' => $cur_ver, 'to' => $cur_ver, 'messages' => ['No update available.']];
    }

    return ['ok' => true, 'action' => 'would_update', 'from' => $cur_ver, 'to' => $new_ver, 'package' => 'transient', 'messages' => ['Update available via update transient.']];
}

function rpu_package_for_plugin($file, $slug)
{
    $trans = get_site_transient('update_plugins');
    if (isset($trans->response[$file]) && ! empty($trans->response[$file]->package)) {
        return $trans->response[$file]->package;
    }
    // Fallback to WP.org info
    $info = rpu_wporg_plugin_info($slug);
    if ($info && !empty($info->download_link)) {
        // Only use if newer than installed
        if (! function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $all = get_plugins();
        $cur = $all[$file]['Version'] ?? null;
        if ($cur && !empty($info->version) && version_compare($cur, $info->version, '<')) {
            return $info->download_link;
        }
    }
    return null;
}

/*
|--------------------------------------------------------------------------
| FILESYSTEM HELPERS
|--------------------------------------------------------------------------
*/
function rpu_init_filesystem()
{
    $creds = request_filesystem_credentials('', '', false, false, null);
    if (! WP_Filesystem($creds)) {
        global $wp_filesystem;
        if (! $wp_filesystem) {
            return new WP_Error('fs_error', 'Could not initialize WP_Filesystem.');
        }
    }
    return true;
}

function rpu_find_single_dir($path)
{
    $items = @scandir($path);
    if (!$items) {
        return null;
    }
    foreach ($items as $i) {
        if ($i === '.' || $i === '..') continue;
        if (is_dir($path . '/' . $i)) {
            return $path . '/' . $i;
        }
    }
    return null;
}

function rpu_copy_dir($from, $to)
{
    global $wp_filesystem;
    if (! $wp_filesystem) {
        rpu_init_filesystem();
    }
    if (! wp_mkdir_p($to)) {
        return new WP_Error('mkdir_failed', 'Could not create staging directory.');
    }
    $result = copy_dir($from, $to);
    if (is_wp_error($result)) {
        return $result;
    }
    return true;
}

function rpu_move_dir($from, $to)
{
    global $wp_filesystem;
    if (! $wp_filesystem) {
        rpu_init_filesystem();
    }
    $parent = dirname($to);
    if (! wp_mkdir_p($parent)) {
        return new WP_Error('mkdir_failed', 'Could not create parent directory for move.');
    }
    // Try WP_Filesystem move; fall back to rename
    if (method_exists($wp_filesystem, 'move')) {
        $ok = $wp_filesystem->move($from, $to, true);
        if (! $ok) {
            return new WP_Error('move_failed', 'Filesystem move failed.');
        }
        return true;
    }
    if (@rename($from, $to)) {
        return true;
    }
    return new WP_Error('rename_failed', 'Rename failed.');
}

function rpu_rrmdir($dir)
{
    if (! is_dir($dir)) return;
    $items = array_diff(scandir($dir), ['.', '..']);
    foreach ($items as $i) {
        $path = "$dir/$i";
        if (is_dir($path)) {
            rpu_rrmdir($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

/*
|--------------------------------------------------------------------------
| REFRESH / VERSION HELPERS
|--------------------------------------------------------------------------
*/
function rpu_global_refresh_updates()
{
    if (function_exists('wp_clean_update_cache')) {
        wp_clean_update_cache();
    }
    delete_site_transient('update_core');
    delete_site_transient('update_plugins');
    delete_site_transient('update_themes');
    wp_version_check();
    wp_update_plugins();
    wp_update_themes();
}

function rpu_refresh_plugin_metadata_for($file)
{
    if (function_exists('wp_clean_plugins_cache')) {
        wp_clean_plugins_cache(true);
    }
    wp_update_plugins();
    if (function_exists('opcache_invalidate')) {
        $plugin_path = WP_PLUGIN_DIR . '/' . $file;
        if (file_exists($plugin_path)) {
            @opcache_invalidate($plugin_path, true);
        }
    }
}

function rpu_get_plugin_version_now($file)
{
    rpu_refresh_plugin_metadata_for($file);
    if (! function_exists('get_plugins')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    $all = get_plugins();
    return $all[$file]['Version'] ?? null;
}

/*
|--------------------------------------------------------------------------
| MAPPING & WP.ORG HELPERS
|--------------------------------------------------------------------------
*/
function rpu_map_slug_to_file(array $all_plugins): array
{
    $map = [];
    foreach ($all_plugins as $file => $data) {
        $slug = explode('/', $file)[0];
        $map[$slug] = $file;
    }
    return $map;
}

function rpu_wporg_latest_version($slug)
{
    $info = rpu_wporg_plugin_info($slug);
    return ($info && !empty($info->version)) ? $info->version : null;
}

function rpu_wporg_plugin_info($slug)
{
    if (empty($slug)) return null;
    static $cache = [];
    if (isset($cache[$slug])) return $cache[$slug];
    $args = ['slug' => $slug, 'fields' => ['sections' => false, 'banners' => false, 'icons' => false]];
    $res  = plugins_api('plugin_information', $args);
    if (is_wp_error($res)) {
        $cache[$slug] = null;
        return null;
    }
    $cache[$slug] = $res;
    return $res;
}
