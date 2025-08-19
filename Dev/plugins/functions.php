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

      // Core info (robust latest finder via get_core_updates)
	require_once ABSPATH . 'wp-includes/version.php';
	$installed = $GLOBALS['wp_version'];

	// Ensure fresh offers (clear stale cache, repopulate)
	delete_site_transient('update_core');
	wp_version_check();

	$offers = get_core_updates(); // canonical list of core offers
	$latest = $installed;
	$has_upgrade = false;

	if (is_array($offers) && !empty($offers)) {
	  foreach ($offers as $o) {
	    // WP may use ->current or ->version depending on context
	    $ver = $o->current ?? ($o->version ?? null);
	    if ($ver && version_compare($ver, $latest, '>')) {
	      $latest = $ver;
	    }
	    if (($o->response ?? '') === 'upgrade') {
	      $has_upgrade = true;
	    }
	  }
	}

	$core_info = [
	  'current_version'  => $installed,
	  'latest_version'   => $latest,
	  'update_available' => $has_upgrade || version_compare($latest, $installed, '>'),
	];


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

  // 🔐 === LOCK START ===
  $lock_key = 'plugin_update_lock';
  $lock_ttl = 600; // 10 minutes

  if (get_transient($lock_key)) {
    return new WP_REST_Response([
      'ok' => false,
      'locked' => true,
      'message' => 'Another plugin update is already in progress.',
    ], 429);
  }

  set_transient($lock_key, true, $lock_ttl);
  // 🔐 === LOCK END ===

  $plugin_files = explode(',', $request->get_param('plugins'));
  $all_plugins = get_plugins();
  $results = [];

  $skin = new class extends WP_Upgrader_Skin {
    public array $messages = [];
    public function feedback($string, ...$args) {
      if (is_string($string)) {
        $this->messages[] = vsprintf($string, (array) $args);
      }
    }
    public function get_messages() {
      return $this->messages;
    }
  };

  $upgrader = new Plugin_Upgrader($skin);

  foreach ($plugin_files as $file) {
    $file = trim($file);
    if (!isset($all_plugins[$file])) {
      $results[$file] = [
        'ok' => false,
        'error' => 'Plugin not found: ' . $file,
      ];
      continue;
    }

    $res = $upgrader->upgrade($file);
    $ok = ($res === true) || (is_array($res) && empty($res['error'])) || ($res === null);

    $results[$file] = [
      'ok' => $ok,
      'raw' => is_wp_error($res) ? $res->get_error_message() : $res,
      'messages' => $skin->get_messages(),
    ];
  }

  // 🧹 Remove lock when done
  delete_transient($lock_key);

  return new WP_REST_Response([
    'ok' => true,
    'updated' => array_keys($results),
    'results' => $results,
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
