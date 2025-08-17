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
// Ensure admin update APIs are available
require_once ABSPATH . 'wp-admin/includes/update.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/theme.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
require_once ABSPATH . 'wp-admin/includes/file.php';

/* =========================================================
   GLOBAL TWEAKS
   ========================================================= */
// Keep temp inside wp-content/upgrade to avoid cross-device moves
if ( ! defined('WP_TEMP_DIR') ) {
  define('WP_TEMP_DIR', WP_CONTENT_DIR . '/upgrade');
}
// Give network calls more time (e.g., large plugin zips)
add_filter('http_request_timeout', function ($t) { return max((int)$t, 300); });

/* =========================================================
   RESCUE HELPERS + ROUTES
   ========================================================= */

/** Copy extracted plugin from wp-content/upgrade into wp-content/plugins */
function nh_rescue_plugin_from_source($source){
  if(!is_dir($source)) return new WP_Error('no_source','Source not found: '.$source);

  // Use single inner dir if present (usual zip layout)
  $inner = null;
  foreach (glob(trailingslashit($source).'*') as $e) { if(is_dir($e)){ $inner=$e; break; } }
  if(!$inner) $inner = $source;

  $slug = basename($inner);
  $dest = trailingslashit(WP_PLUGIN_DIR).$slug;

  WP_Filesystem();
  global $wp_filesystem;
  if ( ! $wp_filesystem->is_dir(dirname($dest)) ) wp_mkdir_p(dirname($dest));
  if ( $wp_filesystem->exists($dest) ) $wp_filesystem->delete($dest, true);

  $ok = copy_dir($inner, $dest);
  if ( is_wp_error($ok) ) return $ok;

  // best-effort perms
  @chmod($dest, 0755);
  if ( class_exists('RecursiveIteratorIterator') ) {
    $it = new RecursiveIteratorIterator(
      new RecursiveDirectoryIterator($dest, FilesystemIterator::SKIP_DOTS),
      RecursiveIteratorIterator::SELF_FIRST
    );
    foreach($it as $p){ @chmod($p->getPathname(), $p->isDir()?0755:0644); }
  }
  return ['slug'=>$slug,'dest'=>$dest];
}

/** Scan wp-content/upgrade for a folder matching the plugin slug and rescue it */
function nh_rescue_plugin_if_stuck($slug){
  $upgrade = trailingslashit(WP_CONTENT_DIR).'upgrade';
  if(!is_dir($upgrade)) return false;

  foreach (glob($upgrade.'/*', GLOB_ONLYDIR) as $cand){
    // if extracted folder is named like slug OR contains a child dir named slug
    if ( basename($cand) === $slug || is_dir(trailingslashit($cand).$slug) ) {
      $res = nh_rescue_plugin_from_source($cand);
      return !is_wp_error($res);
    }
  }
  return false;
}

/** Auto-rescue when copy/rename fails during updates */
add_filter('upgrader_install_package_result', function($result, $hook_extra){
  if ( isset($hook_extra['type']) && $hook_extra['type']==='plugin' && is_wp_error($result) ) {
    $slug = isset($hook_extra['plugin']) ? dirname($hook_extra['plugin']) : '';
    if($slug && nh_rescue_plugin_if_stuck($slug)) {
      return ['rescued'=>true,'slug'=>$slug,'from'=>'upgrade'];
    }
  }
  return $result;
}, 10, 2);

/** REST sanity ping to confirm this file is loaded */
add_action('rest_api_init', function(){
  register_rest_route('custom/v1','/rescue-ping',[
    'methods'=>'GET',
    'permission_callback'=>'__return_true',
    'callback'=>fn()=> new WP_REST_Response(['ok'=>true,'rescue_loaded'=>true],200),
  ]);
});

/** REST: batch repair anything currently sitting in wp-content/upgrade */
add_action('rest_api_init', function(){
  register_rest_route('custom/v1','/repair-plugins',[
    'methods'=>'POST',
    'permission_callback'=>function(){ return current_user_can('update_plugins'); },
    'callback'=>function(){
      $upgrade = trailingslashit(WP_CONTENT_DIR).'upgrade';
      $rescued=[];
      if(is_dir($upgrade)){
        foreach (glob($upgrade.'/*', GLOB_ONLYDIR) as $cand){
          $res = nh_rescue_plugin_from_source($cand);
          if(!is_wp_error($res)) $rescued[]=$res;
        }
      }
      return new WP_REST_Response(['ok'=>true,'rescued'=>$rescued],200);
    }
  ]);
});

/* =========================================================
   STATUS: site/v1/status
   ========================================================= */
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
          'plugin_file'      => $plugin_file,                 // e.g. 'akismet/akismet.php'
          'slug'             => dirname($plugin_file),        // real slug (folder name)
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

      return new WP_REST_Response([
        'core'      => $core_info,
        'php_mysql' => $php_mysql_info,
        'plugins'   => $plugin_info,
        'themes'    => $theme_info,
      ], 200);
    },
  ]);
});

/* =========================================================
   UPDATE PLUGINS: custom/v1/update-plugins
   - Body: {"plugins":["a/b.php","c/d.php"]}  OR  {"plugins":"all"}
   ========================================================= */
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

  // Preflight: plugins dir must be writable
  if ( ! wp_is_writable( WP_PLUGIN_DIR ) ) {
    return new WP_REST_Response([
      'ok' => false,
      'error' => 'Plugins directory not writable: ' . WP_PLUGIN_DIR
    ], 500);
  }

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

  // Allow {"plugins":"all"} to update everything with an available update
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

  // Quiet upgrader skin that still captures messages
  $skin = new class extends WP_Upgrader_Skin {
    public array $messages = [];
    public function header() {}
    public function footer() {}
    public function before() {}
    public function after() {}
    public function error($e) { $this->messages[] = is_wp_error($e) ? $e->get_error_message() : (string)$e; }
    public function feedback($string, ...$args) {
      if (is_string($string)) $this->messages[] = vsprintf($string, (array)$args);
    }
    public function get_upgrade_messages() { return $this->messages; }
  };

  $upgrader = new Plugin_Upgrader($skin);
  $results  = [];

  foreach ($plugins as $pf) {
    $pf = trim($pf);
    if ($pf === '') continue;

    // run the upgrade
    $res = $upgrader->upgrade($pf);

    // default outcome
    $ok = ( $res === true ) || ( is_array($res) && empty($res['error']) );

    // If it failed, try auto-rescue from wp-content/upgrade
    if ( ! $ok ) {
      $slug = dirname($pf);
      if ( function_exists('nh_rescue_plugin_if_stuck') && nh_rescue_plugin_if_stuck($slug) ) {
        $ok = true;
      }
    }

    // Double-check the plugin directory exists post-op
    $plugin_dir = WP_PLUGIN_DIR . '/' . dirname($pf);
    if ( $ok && ! is_dir($plugin_dir) ) {
      // dir still missing? one more rescue try
      $slug = dirname($pf);
      if ( function_exists('nh_rescue_plugin_if_stuck') && nh_rescue_plugin_if_stuck($slug) ) {
        $ok = true;
      } else {
        $ok = false;
      }
    }

    // Surface messages for debugging
    $msg = method_exists($upgrader->skin, 'get_upgrade_messages') ? $upgrader->skin->get_upgrade_messages() : null;

    if ( is_wp_error($res) ) {
      $results[] = [
        'plugin' => $pf,
        'ok'     => false,
        'error'  => [
          'code'    => $res->get_error_code(),
          'message' => $res->get_error_message(),
          'data'    => $res->get_error_data(),
        ],
        'messages' => $msg,
      ];
    } else {
      $item = [ 'plugin' => $pf, 'ok' => (bool)$ok ];
      if ( is_array($res) ) $item['raw'] = $res;
      if ( $msg ) $item['messages'] = $msg;
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

  // Clear caches so next /status shows fresh
  delete_site_transient('update_plugins');
  if ( function_exists('wp_clean_plugins_cache') ) wp_clean_plugins_cache(true);

  $overall_ok = true;
  foreach ($results as $r) { if (empty($r['ok'])) { $overall_ok = false; break; } }

  return new WP_REST_Response([
    'ok'          => $overall_ok,
    'results'     => $results,
    'post_status' => $post,
  ], 200);
}

/* =========================================================
   UPDATE CORE: custom/v1/update-core
   ========================================================= */
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
  if ( ! defined('WP_TEMP_DIR') ) define('WP_TEMP_DIR', WP_CONTENT_DIR . '/upgrade');

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
