<?php
/**
 * The base configuration for WordPress
 *
 * The wp-config.php creation script uses this file during the installation.
 * You don't have to use the web site, you can copy this file to "wp-config.php"
 * and fill in the values.
 *
 * This file contains the following configurations:
 *
 * * Database settings
 * * Secret keys
 * * Database table prefix
 * * Localized language
 * * ABSPATH
 *
 * @link https://wordpress.org/support/article/editing-wp-config-php/
 *
 * @package WordPress
 */

// ** Database settings - You can get this info from your web host ** //
/** The name of the database for WordPress */
define( 'DB_NAME', 'admin' );

/** Database username */
define( 'DB_USER', 'admin' );

/** Database password */
define( 'DB_PASSWORD', 'admin' );

/** Database hostname */
define( 'DB_HOST', 'localhost' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8' );

/** The database collate type. Don't change this if in doubt. */
define( 'DB_COLLATE', '' );

/**#@+
 * Authentication unique keys and salts.
 *
 * Change these to different unique phrases! You can generate these using
 * the {@link https://api.wordpress.org/secret-key/1.1/salt/ WordPress.org secret-key service}.
 *
 * You can change these at any point in time to invalidate all existing cookies.
 * This will force all users to have to log in again.
 *
 * @since 2.6.0
 */
define( 'AUTH_KEY',          'du3sNy<H.O&@`[4d@m3&_lWgy3g!+CFRzGHW*PBxWMEZWirz1F&,p7o%:(9YU`T>' );
define( 'SECURE_AUTH_KEY',   'Oc}}xR|`I1>,A8xu?-lE@G&DZQog|~ R$!1LY*y;J}iML9nhi3/h0h{7Ia#d^*dO' );
define( 'LOGGED_IN_KEY',     'Tff~aDV~#uRbSpOT0dGsfevQ*&*YwL29|kR0><gg:oNDLf:IYmx,kuc{(0Q?kRkc' );
define( 'NONCE_KEY',         'laWrIckf3!F)mZ-nY,%[AxBCT+ZbHg$SRWIM Vn *; 7bRW4u1ivW[X:k$@z4)$_' );
define( 'AUTH_SALT',         'nfs.&zDwV# .2a<&t>Xd82x^@SuOFql0qkz=t5:L:!H_|mp*FX-vA!a4}I{C~gs(' );
define( 'SECURE_AUTH_SALT',  'mr9JtM|n?(}vI#Td(@2+x)q5@/y$74^FAQZ|[XUD1F~ smTl^P);.r-__5N:t7wv' );
define( 'LOGGED_IN_SALT',    'S0QVeBR.R?f{GkAf356p)ez6O$7<AdIMg>R}Z1h#ZshfCpmdaVHZbpx_GOi)u;nK' );
define( 'NONCE_SALT',        'h1ht*Uay6ONCnr*:d2b}98hL]Fj(=imJx(-p|FC1w.BRF3g%Z`~9x6!Wn:@%x4yB' );
define( 'WP_CACHE_KEY_SALT', '^G3%RmFJ{;,*6yq4:74,U=8L;J{5%.geOK@_v>ug+wkIz5<KO0{a2 n|=A~:n8O}' );


/**#@-*/

/**
 * WordPress database table prefix.
 *
 * You can have multiple installations in one database if you give each
 * a unique prefix. Only numbers, letters, and underscores please!
 */
$table_prefix = 'wp_';


/* Add any custom values between this line and the "stop editing" line. */



/**
 * For developers: WordPress debugging mode.
 *
 * Change this to true to enable the display of notices during development.
 * It is strongly recommended that plugin and theme developers use WP_DEBUG
 * in their development environments.
 *
 * For information on other constants that can be used for debugging,
 * visit the documentation.
 *
 * @link https://wordpress.org/support/article/debugging-in-wordpress/
 */
if ( ! defined( 'WP_DEBUG' ) ) {
	define( 'WP_DEBUG', false );
}

define('REST_AUTHORIZATION_HEADER', true);
define('FS_METHOD', 'direct');
define('WP_MEMORY_LIMIT','512M');
define('DISALLOW_FILE_MODS', false);
define('WP_MAX_MEMORY_LIMIT', '512M');

/* That's all, stop editing! Happy publishing. */

/** Absolute path to the WordPress directory. */
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}

/** Sets up WordPress vars and included files. */
require_once ABSPATH . 'wp-settings.php';
