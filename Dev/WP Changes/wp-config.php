<?php
/********************
*******************
********************
******************
*****************
/* Add any custom values between this line and the "stop editing" line. */


define('REST_AUTHORIZATION_HEADER', true);
define('FS_METHOD', 'direct');
define('WP_MEMORY_LIMIT','512M');
define('DISALLOW_FILE_MODS', false);
define('WP_MAX_MEMORY_LIMIT', '512M');
define('WP_TEMP_DIR', __DIR__ . '/wp-content/upgrade/');  // ensure writable temp
// Make 100% sure outbound HTTP & updates are not blocked:
if (!defined('WP_HTTP_BLOCK_EXTERNAL')) define('WP_HTTP_BLOCK_EXTERNAL', false);
if (!defined('DISALLOW_FILE_MODS')) define('DISALLOW_FILE_MODS', false);
//define('WP_TEMP_DIR', WP_CONTENT_DIR . '/upgrade');

/* That's all, stop editing! Happy publishing. */

/** Absolute path to the WordPress directory. */
/********************************************
