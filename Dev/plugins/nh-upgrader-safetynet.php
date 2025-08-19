<?php
/**
 * Plugin Name: NH Upgrader Safety Net (MU)
 * Description: Backup plugin folders before update; restore automatically if the update fails.
 * Author: you
 */

if ( ! defined('ABSPATH') ) return;

add_action('muplugins_loaded', function () {
  if ( ! defined('WP_TEMP_DIR') ) define('WP_TEMP_DIR', WP_CONTENT_DIR . '/upgrade');
  add_filter('unzip_file_use_ziparchive', '__return_true');
  add_filter('http_request_timeout', fn($t)=>max((int)$t,300));

  // Where we keep temporary backups (inside upgrade so same filesystem)
  if ( ! defined('NH_PLUGIN_BACKUPS') )
    define('NH_PLUGIN_BACKUPS', WP_CONTENT_DIR . '/upgrade/plugin-backups');

  // Make sure backup dir exists
  if ( ! is_dir(NH_PLUGIN_BACKUPS) ) @wp_mkdir_p(NH_PLUGIN_BACKUPS);

  // Helper: get plugin dir from "akismet/akismet.php"
  $plugin_dir = function ($plugin_file) {
    $slug = dirname($plugin_file);
    return ($slug === '.' ? '' : $slug);
  };

  // 1) Before install: back up existing plugin folders
  add_filter('upgrader_pre_install', function ($return, $hook_extra) use ($plugin_dir) {
    if ( ! empty($hook_extra['type']) && $hook_extra['type']==='plugin' ) {

      // List of plugin basenames being updated
      $targets = [];
      if ( ! empty($hook_extra['plugin']) )  $targets[] = $hook_extra['plugin'];
      if ( ! empty($hook_extra['plugins']) ) $targets = array_merge($targets, (array)$hook_extra['plugins']);
      $targets = array_unique(array_filter($targets));

      $map = []; // pluginDir => backupDir
      foreach ($targets as $base) {
        $dir = $plugin_dir($base);
        if ( ! $dir ) continue;
        $abs = WP_PLUGIN_DIR . '/' . $dir;
        if ( ! is_dir($abs) ) continue;
        $backup = trailingslashit(NH_PLUGIN_BACKUPS) . $dir . '-' . time();
        // Move is fastest & atomic on same FS; fall back to copy
        if ( @rename($abs, $backup) || ( @wp_mkdir_p($backup) && copy_dir($abs, $backup) && @rename($abs, $abs.'-old') ) ) {
          $map[$abs] = $backup;
          // Ensure destination dir exists again so WP can write into it
          @wp_mkdir_p($abs);
        }
      }

      if ( $map ) {
        set_transient('nh_updater_backups', $map, 60 * 60); // keep for an hour
        @set_time_limit(600);
        if ( function_exists('wp_raise_memory_limit') ) wp_raise_memory_limit('admin');
      }
    }
    return $return;
  }, 10, 2);

  // 2) After WP copies files: if result is error, restore; if success, purge backups
  add_filter('upgrader_install_package_result', function ($result, $hook_extra) {
    if ( empty($hook_extra['type']) || $hook_extra['type']!=='plugin' ) return $result;

    $map = get_transient('nh_updater_backups');
    if ( ! is_array($map) || ! $map ) return $result;

    $is_error = is_wp_error($result);
    foreach ($map as $dest => $backup) {
      if ( $is_error ) {
        // Restore original
        if ( is_dir($backup) ) {
          // Remove partial install if present, then restore
          if ( is_dir($dest) ) @rmdir($dest); // best effort
          @rename($backup, $dest);
          error_log('[NH SafetyNet] Restored plugin from backup: '.$dest);
        }
      } else {
        // Success: remove backup
        if ( is_dir($backup) ) {
          // Best-effort cleanup
          require_once ABSPATH . 'wp-admin/includes/file.php';
          @WP_Filesystem();
          global $wp_filesystem;
          if ( $wp_filesystem ) { $wp_filesystem->rmdir($backup, true); }
        }
      }
    }
    delete_transient('nh_updater_backups');
    return $result;
  }, 10, 2);
});
