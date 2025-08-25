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

if ( ! defined( 'ABSPATH' ) ) exit;

// --- Common Includes (load early) ---
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/theme.php';
require_once ABSPATH . 'wp-admin/includes/update.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

//
// -------- Silent Skins (no HTML output) --------
//

class SUE_Silent_Single_Skin extends WP_Upgrader_Skin {
	public array $messages = [];
	public function header() {}
	public function footer() {}
	public function before() {}
	public function after() {}
	public function feedback( $string, ...$args ) {
		if ( is_string( $string ) ) $this->messages[] = vsprintf( $string, (array) $args );
	}
	public function error( $errors ) {
		$this->messages[] = is_wp_error( $errors ) ? $errors->get_error_message() : (string) $errors;
	}
	public function get_messages() { return $this->messages; }
}

class SUE_Silent_Bulk_Plugin_Skin extends Bulk_Plugin_Upgrader_Skin {
	public array $messages = [];
	public function header() {}
	public function footer() {}
	public function feedback( $string, ...$args ) {
		if ( is_string( $string ) ) $this->messages[] = vsprintf( $string, (array) $args );
	}
	public function error( $errors ) {
		$this->messages[] = is_wp_error( $errors ) ? $errors->get_error_message() : (string) $errors;
	}
	public function get_messages() { return $this->messages; }
}

class SUE_Silent_Bulk_Theme_Skin extends Bulk_Theme_Upgrader_Skin {
	public array $messages = [];
	public function header() {}
	public function footer() {}
	public function feedback( $string, ...$args ) {
		if ( is_string( $string ) ) $this->messages[] = vsprintf( $string, (array) $args );
	}
	public function error( $errors ) {
		$this->messages[] = is_wp_error( $errors ) ? $errors->get_error_message() : (string) $errors;
	}
	public function get_messages() { return $this->messages; }
}

class SUE_Silent_Core_Skin extends WP_Upgrader_Skin {
	public array $messages = [];
	public function header() {}
	public function footer() {}
	public function feedback( $string, ...$args ) {}
	public function error( $errors ) {
		$this->messages[] = is_wp_error( $errors ) ? $errors->get_error_message() : (string) $errors;
	}
	public function get_messages() { return $this->messages; }
}

//
// -------- Helpers --------
//

/**
 * Ensure filesystem is ready and use 'direct' where safe.
 */
function sue_prepare_filesystem() {
	if ( ! defined( 'FS_METHOD' ) ) {
		define( 'FS_METHOD', 'direct' );
	}
	global $wp_filesystem;
	if ( empty( $wp_filesystem ) ) {
		WP_Filesystem();
	}
}

/**
 * Normalize truthy check for upgrader results.
 *
 * @param mixed $res
 * @return bool
 */
function sue_result_ok( $res ) {
	// WP can return true, null (already latest), or an array without 'error'
	if ( $res === true || $res === null ) return true;
	if ( is_array( $res ) && empty( $res['error'] ) ) return true;
	return ! is_wp_error( $res ) && (bool) $res;
}

//
// -------- STATUS: GET /wp-json/site/v1/status --------
//

add_action( 'rest_api_init', function () {
	register_rest_route( 'site/v1', '/status', [
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function () {
			require_once ABSPATH . 'wp-includes/version.php';

			// Trigger update checks so transients are fresh.
			wp_version_check();
			wp_update_plugins();
			wp_update_themes();

			// Core info
			$core_updates = get_site_transient( 'update_core' );
			$core_info = [
				'current_version'   => $GLOBALS['wp_version'],
				'update_available'  => false,
				'latest_version'    => null,
			];
			if ( ! empty( $core_updates->updates[0] ) && $core_updates->updates[0]->response !== 'latest' ) {
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
			$active_plugins = get_option( 'active_plugins', [] );
			$plugin_updates = get_plugin_updates();         // [plugin_file => (obj with ->update->new_version)]
			$plugin_info    = [];

			foreach ( $all_plugins as $plugin_file => $plugin_data ) {
				$update = $plugin_updates[ $plugin_file ] ?? null;

				$plugin_info[] = [
					'plugin_file'      => $plugin_file, // e.g. akismet/akismet.php
					'slug'             => sanitize_title( $plugin_data['Name'] ),
					'name'             => $plugin_data['Name'],
					'version'          => $plugin_data['Version'],
					'active'           => in_array( $plugin_file, $active_plugins, true ),
					'update_available' => (bool) $update,
					'latest_version'   => $update->update->new_version ?? $plugin_data['Version'],
				];
			}

			// Themes
			$themes         = wp_get_themes();             // [stylesheet => WP_Theme]
			$active_theme   = wp_get_theme();
			$theme_updates  = get_theme_updates();         // [stylesheet => (obj->update->new_version)]
			$theme_info     = [];

			foreach ( $themes as $stylesheet => $theme ) {
				$update = $theme_updates[ $stylesheet ] ?? null;
				$theme_info[] = [
					'stylesheet'       => $stylesheet,
					'name'             => $theme->get( 'Name' ),
					'version'          => $theme->get( 'Version' ),
					'active'           => ( $theme->get_stylesheet() === $active_theme->get_stylesheet() ),
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
	] );
} );

//
// -------- PLUGINS: POST /wp-json/custom/v1/update-plugins --------
//

add_action( 'rest_api_init', function () {
	register_rest_route( 'custom/v1', '/update-plugins', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can( 'update_plugins' );
		},
		'callback'            => 'sue_handle_update_plugins',
		'args'                => [
			'plugins' => [ 'required' => false ],
			'mode'    => [ 'required' => false ], // auto|single|bulk
		],
	] );
} );

// [2] Helper: delete WP_CONTENT_DIR/upgrade-temp-backup/plugins/<slug>
if ( ! function_exists( 'nh_delete_plugin_backup_dir' ) ) {
	require_once ABSPATH . 'wp-admin/includes/file.php';

	/**
	 * Delete upgrade-temp-backup dir for a plugin (if exists).
	 * @param string $plugin_file e.g. "all-in-one-wp-migration/all-in-one-wp-migration.php"
	 */
	function nh_delete_plugin_backup_dir( string $plugin_file ): bool {
		$slug = dirname( $plugin_file ); // "all-in-one-wp-migration"
		$base = WP_CONTENT_DIR . '/upgrade-temp-backup/plugins';
		$dir  = trailingslashit( $base ) . untrailingslashit( $slug );

		if ( ! file_exists( $dir ) ) {
			return false;
		}

		global $wp_filesystem;
		if ( ! $wp_filesystem ) {
			WP_Filesystem();
		}
		if ( $wp_filesystem && $wp_filesystem->is_dir( $dir ) ) {
			return (bool) $wp_filesystem->delete( $dir, true );
		}
		return false;
	}
}

// [3] Helper: filesystem diagnostics (writability, existence) for targets
if ( ! function_exists( 'nh_fs_preflight_plugins' ) ) {
	require_once ABSPATH . 'wp-admin/includes/file.php';

	/**
	 * Return FS diagnostics for plugin update preflight.
	 * @param array $targets array of plugin_file basenames
	 * @return array
	 */
	function nh_fs_preflight_plugins( array $targets ): array {
		$base_src = WP_PLUGIN_DIR; // wp-content/plugins
		$base_bak = WP_CONTENT_DIR . '/upgrade-temp-backup/plugins';

		// Ensure backup base exists
		wp_mkdir_p( $base_bak );

		$checks = [
			'wp_plugin_dir_writable' => wp_is_writable( $base_src ),
			'backup_base_exists'     => is_dir( $base_bak ),
			'backup_base_writable'   => wp_is_writable( $base_bak ),
			'php_user'               => ( function_exists( 'posix_getpwuid' ) && function_exists( 'posix_geteuid' ) )
				? ( posix_getpwuid( posix_geteuid() )['name'] ?? 'unknown' )
				: 'unknown',
			'slugs'                  => [],
		];

		foreach ( $targets as $pf ) {
			$slug = dirname( $pf );
			$src  = trailingslashit( $base_src ) . $slug;
			$bak  = trailingslashit( $base_bak ) . $slug;

			$checks['slugs'][ $slug ] = [
				'source_exists'       => is_dir( $src ),
				'source_writable'     => wp_is_writable( $src ),
				'backup_exists'       => is_dir( $bak ),
				'backup_writable_par' => wp_is_writable( dirname( $bak ) ),
			];
		}

		return $checks;
	}
}

// [4] (Optional) Janitor: prune old leftover backups > 1h
if ( ! function_exists( 'nh_prune_old_backups' ) ) {
	function nh_prune_old_backups( int $max_age_secs = 3600 ): void {
		$base = WP_CONTENT_DIR . '/upgrade-temp-backup/plugins';
		if ( ! is_dir( $base ) ) { return; }
		foreach ( glob( $base . '/*', GLOB_ONLYDIR ) as $d ) {
			$age = time() - @filemtime( $d );
			if ( $age > $max_age_secs ) {
				// fabricate a plugin_file so deleter can compute slug path
				$slug = basename( $d );
				nh_delete_plugin_backup_dir( $slug . '/plugin.php' );
			}
		}
	}
}

// [5] Handler
function sue_handle_update_plugins( WP_REST_Request $request ) {
	// Ensure WP upgrader & plugin APIs are loaded (no-ops if already)
	require_once ABSPATH . 'wp-admin/includes/update.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
	require_once ABSPATH . 'wp-admin/includes/file.php';

	// Your existing helper should set FS_METHOD/direct etc.
	if ( function_exists( 'sue_prepare_filesystem' ) ) {
		sue_prepare_filesystem();
	}

	// Refresh available plugin updates
	wp_update_plugins();

	$param_plugins = trim( (string) $request->get_param( 'plugins' ) );
	$mode          = strtolower( (string) ( $request->get_param( 'mode' ) ?: 'auto' ) );

	// Build target list of plugin basenames
	$targets = [];
	if ( $param_plugins === '' || $param_plugins === 'all' ) {
		$updates = get_plugin_updates(); // only those with updates
		$targets = array_keys( $updates );
	} elseif ( $param_plugins === 'all-installed' ) {
		$targets = array_keys( get_plugins() );
	} else {
		$list      = array_filter( array_map( 'trim', explode( ',', $param_plugins ) ) );
		$installed = array_keys( get_plugins() );
		$targets   = array_values( array_intersect( $list, $installed ) );
	}

	// PRE-CLEAN: ensure base dir & remove any stale backup dirs for targets
	wp_mkdir_p( WP_CONTENT_DIR . '/upgrade-temp-backup/plugins' );
	foreach ( $targets as $__pf ) {
		nh_delete_plugin_backup_dir( $__pf );
	}
	$fs_diag = nh_fs_preflight_plugins( $targets ); // collect diagnostics

	if ( empty( $targets ) ) {
		return new WP_REST_Response( [
			'ok'      => true,
			'message' => 'No plugins to update',
			'results' => [],
			'fs_diag' => $fs_diag,
		], 200 );
	}

	if ( $mode === 'auto' ) {
		$mode = ( count( $targets ) > 1 ) ? 'bulk' : 'single';
	}

	$overall_ok       = true;
	$response_results = [];

	if ( $mode === 'single' ) {
		$plugin_file = $targets[0];
		$skin        = class_exists( 'SUE_Silent_Single_Skin' ) ? new SUE_Silent_Single_Skin() : new Automatic_Upgrader_Skin();
		$upgrader    = new Plugin_Upgrader( $skin );

		$res = $upgrader->upgrade( $plugin_file ); // bool|array|WP_Error|null
		$ok  = function_exists( 'sue_result_ok' ) ? sue_result_ok( $res ) : ( ! is_wp_error( $res ) && ( $res || is_array( $res ) ) );
		if ( ! $ok ) { $overall_ok = false; }

		$response_results[ $plugin_file ] = [
			'ok'       => (bool) $ok,
			'raw'      => is_wp_error( $res ) ? $res->get_error_message() : ( is_array( $res ) ? $res : (bool) $res ),
			'messages' => method_exists( $skin, 'get_messages' ) ? $skin->get_messages() : null,
		];

		// POST-CLEAN: remove backup dir when update succeeded
		if ( $ok ) {
			nh_delete_plugin_backup_dir( $plugin_file );
		}

	} else {
		// BULK – mirrors wp-admin’s "Update Selected"
		$skin     = class_exists( 'SUE_Silent_Bulk_Plugin_Skin' ) ? new SUE_Silent_Bulk_Plugin_Skin( [ 'nonce' => 'bulk-update-plugins' ] ) : new Bulk_Plugin_Upgrader_Skin();
		$upgrader = new Plugin_Upgrader( $skin );

		$results = $upgrader->bulk_upgrade( $targets ); // array keyed by plugin_file

		foreach ( $targets as $plugin_file ) {
			$res = $results[ $plugin_file ] ?? null;
			$ok  = function_exists( 'sue_result_ok' ) ? sue_result_ok( $res ) : ( ! is_wp_error( $res ) && ( $res || is_array( $res ) ) );
			if ( ! $ok ) { $overall_ok = false; }

			$response_results[ $plugin_file ] = [
				'ok'  => (bool) $ok,
				'raw' => is_wp_error( $res ) ? $res->get_error_message() : ( is_array( $res ) ? $res : (bool) $res ),
			];

			// POST-CLEAN per plugin on success
			if ( $ok ) {
				nh_delete_plugin_backup_dir( $plugin_file );
			}
		}

		if ( method_exists( $skin, 'get_messages' ) ) {
			$response_results['_messages'] = $skin->get_messages();
		}
	}

	// Clean caches + prune old leftovers
	delete_site_transient( 'update_plugins' );
	if ( function_exists( 'wp_clean_plugins_cache' ) ) {
		wp_clean_plugins_cache( true );
	}
	if ( function_exists( 'nh_prune_old_backups' ) ) {
		nh_prune_old_backups( 3600 ); // 1 hour
	}

	return new WP_REST_Response( [
		'ok'      => (bool) $overall_ok,
		'mode'    => $mode,
		'updated' => array_keys( array_filter( $response_results, function( $r ) { return ! isset( $r['ok'] ) || $r['ok']; } ) ),
		'results' => $response_results,
		'fs_diag' => $fs_diag,
	], 200 );
}

//
// -------- CORE: POST /wp-json/custom/v1/update-core --------
//

add_action( 'rest_api_init', function () {
	register_rest_route( 'custom/v1', '/update-core', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can( 'update_core' );
		},
		'callback'            => 'sue_handle_update_core',
	] );
} );

function sue_handle_update_core( WP_REST_Request $request ) {
	sue_prepare_filesystem();

	// Clear any stale core lock
	delete_option( 'core_updater.lock' );

	// Refresh core updates
	wp_version_check();
	$updates = get_site_transient( 'update_core' );

	if ( empty( $updates->updates ) || $updates->updates[0]->response !== 'upgrade' ) {
		return new WP_REST_Response( [ 'message' => 'No core update available' ], 200 );
	}

	try {
		$skin     = new SUE_Silent_Core_Skin();
		$upgrader = new Core_Upgrader( $skin );
		$result   = $upgrader->upgrade( $updates->updates[0] );
	} catch ( Throwable $e ) {
		return new WP_REST_Response( [ 'error' => $e->getMessage() ], 500 );
	}

	if ( is_wp_error( $result ) ) {
		return new WP_REST_Response( [ 'error' => $result->get_error_message() ], 500 );
	}

	return new WP_REST_Response( [ 'message' => 'WordPress core updated successfully' ], 200 );
}

//
// -------- THEMES: POST /wp-json/custom/v1/update-themes --------
//

add_action( 'rest_api_init', function () {
	register_rest_route( 'custom/v1', '/update-themes', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can( 'update_themes' );
		},
		'callback'            => 'sue_handle_update_themes',
		'args'                => [
			'themes' => [ 'required' => false ], // "all" | "all-installed" | CSV of stylesheets
			'mode'   => [ 'required' => false ], // auto|single|bulk
		],
	] );
} );

function sue_handle_update_themes( WP_REST_Request $request ) {
	sue_prepare_filesystem();

	// Refresh available theme updates
	wp_update_themes();

	$param_themes = trim( (string) $request->get_param( 'themes' ) );
	$mode         = strtolower( (string) ( $request->get_param( 'mode' ) ?: 'auto' ) );

	// Build target list of theme stylesheets (keys of wp_get_themes)
	$targets = [];
	if ( $param_themes === '' || $param_themes === 'all' ) {
		$updates = get_theme_updates();             // [stylesheet => obj]
		$targets = array_keys( $updates );
	} elseif ( $param_themes === 'all-installed' ) {
		$targets = array_keys( wp_get_themes() );   // all stylesheets
	} else {
		$list     = array_filter( array_map( 'trim', explode( ',', $param_themes ) ) );
		$installed = array_keys( wp_get_themes() );
		$targets   = array_values( array_intersect( $list, $installed ) );
	}

	if ( empty( $targets ) ) {
		return new WP_REST_Response( [
			'ok'      => true,
			'message' => 'No themes to update',
			'results' => [],
		], 200 );
	}

	if ( $mode === 'auto' ) {
		$mode = ( count( $targets ) > 1 ) ? 'bulk' : 'single';
	}

	$overall_ok       = true;
	$response_results = [];

	if ( $mode === 'single' ) {
		$stylesheet = $targets[0];
		$skin       = new SUE_Silent_Single_Skin();
		$upgrader   = new Theme_Upgrader( $skin );

		$res = $upgrader->upgrade( $stylesheet );
		$ok  = sue_result_ok( $res );
		if ( ! $ok ) $overall_ok = false;

		$response_results[ $stylesheet ] = [
			'ok'       => $ok,
			'raw'      => is_wp_error( $res ) ? $res->get_error_message() : ( is_array( $res ) ? $res : (bool) $res ),
			'messages' => method_exists( $skin, 'get_messages' ) ? $skin->get_messages() : null,
		];
	} else {
		$skin     = new SUE_Silent_Bulk_Theme_Skin( [ 'nonce' => 'bulk-update-themes' ] );
		$upgrader = new Theme_Upgrader( $skin );

		$results = $upgrader->bulk_upgrade( $targets ); // array keyed by stylesheet

		foreach ( $targets as $stylesheet ) {
			$res = $results[ $stylesheet ] ?? null;
			$ok  = sue_result_ok( $res );
			if ( ! $ok ) $overall_ok = false;

			$response_results[ $stylesheet ] = [
				'ok'  => $ok,
				'raw' => is_wp_error( $res ) ? $res->get_error_message() : ( is_array( $res ) ? $res : (bool) $res ),
			];
		}

		if ( method_exists( $skin, 'get_messages' ) ) {
			$response_results['_messages'] = $skin->get_messages();
		}
	}

	// Clean caches
	delete_site_transient( 'update_themes' );
	if ( function_exists( 'wp_clean_themes_cache' ) ) wp_clean_themes_cache( true );

	return new WP_REST_Response( [
		'ok'      => $overall_ok,
		'mode'    => $mode,
		'updated' => array_keys( array_filter( $response_results, fn( $r ) => ! isset( $r['ok'] ) || $r['ok'] ) ),
		'results' => $response_results,
	], 200 );
}
