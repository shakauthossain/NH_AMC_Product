// Plugin name/slug normalization utility for WordPress plugin updates

export interface PluginInfo {
  name: string;
  slug: string;
  plugin_file: string;
  version?: string;
  active?: boolean;
  update_available?: boolean;
}

export interface NormalizationResult {
  original: string;
  normalized: string;
  confidence: 'high' | 'medium' | 'low';
  method: 'exact' | 'slug_match' | 'name_match' | 'guess';
}

export interface NormalizationDebugInfo {
  input: string[];
  results: NormalizationResult[];
  final_plugin_files: string[];
  available_plugins: PluginInfo[];
}

/**
 * Common WordPress plugin slug to plugin file mappings
 */
const COMMON_PLUGIN_MAPPINGS: Record<string, string> = {
  // Popular plugins with non-standard directory structures
  'all-in-one-wp-migration': 'all-in-one-wp-migration/all-in-one-wp-migration.php',
  'yoast-seo': 'wordpress-seo/wp-seo.php',
  'jetpack': 'jetpack/jetpack.php',
  'woocommerce': 'woocommerce/woocommerce.php',
  'elementor': 'elementor/elementor.php',
  'contact-form-7': 'contact-form-7/wp-contact-form-7.php',
  'akismet': 'akismet/akismet.php',
  'wordfence': 'wordfence/wordfence.php',
  'wp-rocket': 'wp-rocket/wp-rocket.php',
  'advanced-custom-fields': 'advanced-custom-fields/acf.php',
  'updraftplus': 'updraftplus/updraftplus.php',
  'wp-super-cache': 'wp-super-cache/wp-cache.php',
  'duplicate-post': 'duplicate-post/duplicate-post.php',
  'classic-editor': 'classic-editor/classic-editor.php',
  'wp-optimize': 'wp-optimize/wp-optimize.php',
  'mailchimp-for-wp': 'mailchimp-for-wp/mailchimp-for-wp.php',
  'really-simple-ssl': 'really-simple-ssl/rlrsssl-really-simple-ssl.php',
  'loco-translate': 'loco-translate/loco.php',
  'wp-mail-smtp': 'wp-mail-smtp/wp_mail_smtp.php',
  'hello-dolly': 'hello.php', // Special case - no directory
};

/**
 * Common WordPress plugin name variations
 */
const PLUGIN_NAME_VARIATIONS: Record<string, string> = {
  // Name variations to slug mappings
  'All-in-One WP Migration': 'all-in-one-wp-migration',
  'Yoast SEO': 'yoast-seo',
  'WordPress SEO by Yoast': 'yoast-seo',
  'WooCommerce': 'woocommerce',
  'Elementor Website Builder': 'elementor',
  'Elementor': 'elementor',
  'Contact Form 7': 'contact-form-7',
  'Akismet Anti-Spam': 'akismet',
  'Wordfence Security': 'wordfence',
  'WP Rocket': 'wp-rocket',
  'Advanced Custom Fields': 'advanced-custom-fields',
  'UpdraftPlus WordPress Backup Plugin': 'updraftplus',
  'UpdraftPlus': 'updraftplus',
  'WP Super Cache': 'wp-super-cache',
  'Duplicate Post': 'duplicate-post',
  'Classic Editor': 'classic-editor',
  'WP-Optimize': 'wp-optimize',
  'MailChimp for WordPress': 'mailchimp-for-wp',
  'Really Simple SSL': 'really-simple-ssl',
  'Loco Translate': 'loco-translate',
  'WP Mail SMTP': 'wp-mail-smtp',
  'Hello Dolly': 'hello-dolly',
};

export class PluginNormalizer {
  private availablePlugins: PluginInfo[] = [];
  private debugInfo: NormalizationDebugInfo;

  constructor(availablePlugins: PluginInfo[] = []) {
    this.availablePlugins = availablePlugins;
    this.debugInfo = {
      input: [],
      results: [],
      final_plugin_files: [],
      available_plugins: availablePlugins,
    };
  }

  /**
   * Update the list of available plugins from WP status
   */
  updateAvailablePlugins(plugins: PluginInfo[]) {
    this.availablePlugins = plugins;
    this.debugInfo.available_plugins = plugins;
  }

  /**
   * Normalize plugin names/slugs to plugin_file format
   */
  normalizePlugins(pluginInputs: string[]): NormalizationDebugInfo {
    this.debugInfo = {
      input: pluginInputs,
      results: [],
      final_plugin_files: [],
      available_plugins: this.availablePlugins,
    };

    for (const input of pluginInputs) {
      const result = this.normalizePlugin(input);
      this.debugInfo.results.push(result);
      
      if (result.normalized) {
        this.debugInfo.final_plugin_files.push(result.normalized);
      }
    }

    return this.debugInfo;
  }

  private normalizePlugin(input: string): NormalizationResult {
    const trimmedInput = input.trim();
    
    // If it's already a plugin file (contains .php), keep it as-is
    if (trimmedInput.endsWith('.php')) {
      return {
        original: input,
        normalized: trimmedInput,
        confidence: 'high',
        method: 'exact',
      };
    }

    // Try exact slug match in common mappings
    if (COMMON_PLUGIN_MAPPINGS[trimmedInput]) {
      return {
        original: input,
        normalized: COMMON_PLUGIN_MAPPINGS[trimmedInput],
        confidence: 'high',
        method: 'slug_match',
      };
    }

    // Try name variation match
    if (PLUGIN_NAME_VARIATIONS[trimmedInput]) {
      const slug = PLUGIN_NAME_VARIATIONS[trimmedInput];
      if (COMMON_PLUGIN_MAPPINGS[slug]) {
        return {
          original: input,
          normalized: COMMON_PLUGIN_MAPPINGS[slug],
          confidence: 'high',
          method: 'name_match',
        };
      }
    }

    // Try to match against available plugins by name
    const nameMatch = this.availablePlugins.find(p => 
      p.name && p.name.toLowerCase() === trimmedInput.toLowerCase()
    );
    if (nameMatch && nameMatch.plugin_file) {
      return {
        original: input,
        normalized: nameMatch.plugin_file,
        confidence: 'high',
        method: 'exact',
      };
    }

    // Try to match against available plugins by slug
    const slugMatch = this.availablePlugins.find(p => 
      p.slug && p.slug.toLowerCase() === trimmedInput.toLowerCase()
    );
    if (slugMatch && slugMatch.plugin_file) {
      return {
        original: input,
        normalized: slugMatch.plugin_file,
        confidence: 'high',
        method: 'exact',
      };
    }

    // Try partial name matching
    const partialNameMatch = this.availablePlugins.find(p => 
      p.name && (
        p.name.toLowerCase().includes(trimmedInput.toLowerCase()) ||
        trimmedInput.toLowerCase().includes(p.name.toLowerCase())
      )
    );
    if (partialNameMatch && partialNameMatch.plugin_file) {
      return {
        original: input,
        normalized: partialNameMatch.plugin_file,
        confidence: 'medium',
        method: 'name_match',
      };
    }

    // Try to guess based on slug format
    const guessedPluginFile = this.guessPluginFile(trimmedInput);
    if (guessedPluginFile) {
      return {
        original: input,
        normalized: guessedPluginFile,
        confidence: 'low',
        method: 'guess',
      };
    }

    // Return empty if we can't normalize
    return {
      original: input,
      normalized: '',
      confidence: 'low',
      method: 'guess',
    };
  }

  private guessPluginFile(slug: string): string {
    // Common patterns for plugin files
    const patterns = [
      `${slug}/${slug}.php`,           // most common
      `${slug}/index.php`,             // some plugins use index
      `${slug}/plugin.php`,            // some use plugin.php
      `${slug}/${slug.replace(/-/g, '_')}.php`, // underscores instead of dashes
    ];

    // Return the most likely pattern
    return patterns[0];
  }

  /**
   * Get debug information from the last normalization
   */
  getDebugInfo(): NormalizationDebugInfo {
    return this.debugInfo;
  }

  /**
   * Create a summary of normalization for logging
   */
  getSummary(): string {
    const { input, final_plugin_files, results } = this.debugInfo;
    const successful = results.filter(r => r.normalized).length;
    const highConfidence = results.filter(r => r.confidence === 'high').length;
    
    return `Normalized ${successful}/${input.length} plugins (${highConfidence} high confidence): ${final_plugin_files.join(', ')}`;
  }
}

/**
 * Convenience function for quick normalization
 */
export function normalizePluginList(
  pluginInputs: string[], 
  availablePlugins: PluginInfo[] = []
): { normalized: string[]; debugInfo: NormalizationDebugInfo } {
  const normalizer = new PluginNormalizer(availablePlugins);
  const debugInfo = normalizer.normalizePlugins(pluginInputs);
  
  return {
    normalized: debugInfo.final_plugin_files,
    debugInfo,
  };
}
