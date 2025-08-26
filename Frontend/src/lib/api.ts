// API Service Layer for WordPress Management Dashboard

import { normalizePluginList, type PluginInfo, type NormalizationDebugInfo } from './plugin-normalizer';

export interface SiteConnection {
  host: string;
  user: string;
  key_filename?: string | null;
  private_key_pem?: string | null;
  password?: string | null;
  wp_path?: string;
}

export interface SiteConfig extends SiteConnection {
  db_name: string;
  db_user: string;
  db_pass: string;
  port?: number;
}

export interface WPInstallRequest {
  domain?: string;
  wp_path: string;
  site_title: string;
  admin_user: string;
  admin_pass: string;
  admin_email: string;
  db_name: string;
  db_user: string;
  db_pass: string;
  php_version: string;
  wp_version: string;
  report_email: string;
}

export interface TaskResponse {
  task_id: string;
  status: string;
}

export interface TaskStatus {
  task_id: string;
  state: 'PENDING' | 'STARTED' | 'SUCCESS' | 'FAILURE';
  result?: any;
  info?: string;
}

export interface ServiceInfo {
  ok: boolean;
  service: string;
}

export interface SiteInfo {
  site_id: string;
  host: string;
  user: string;
  wp_path: string;
}

export interface LoginResponse {
  site_id: string;
  verified: boolean;
}

// Settings management
export interface ApiSettings {
  baseUrl: string;
  defaultAuth?: {
    username: string;
    password: string;
  };
  customHeaders?: Record<string, string>;
  resetToken?: string;
}

class ApiService {
  private settings: ApiSettings;

  constructor() {
    this.settings = this.loadSettings();
  }

  private loadSettings(): ApiSettings {
    const saved = localStorage.getItem('wp-dashboard-settings');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      baseUrl: 'http://localhost:8000',
    };
  }

  updateSettings(settings: ApiSettings) {
    this.settings = settings;
    localStorage.setItem('wp-dashboard-settings', JSON.stringify(settings));
  }

  getSettings(): ApiSettings {
    return { ...this.settings };
  }

  private async fetchWithHandling<T>(
    path: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.settings.baseUrl}${path}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.settings.customHeaders,
      ...options.headers as Record<string, string>,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle file downloads
    const contentType = response.headers.get('content-type');
    const contentDisposition = response.headers.get('content-disposition');
    
    if (contentDisposition?.includes('attachment') || 
        (contentType && !contentType.includes('application/json'))) {
      const blob = await response.blob();
      const filename = this.extractFilename(contentDisposition) || 'download';
      this.downloadBlob(blob, filename);
      return { downloaded: true, filename } as T;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  private extractFilename(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;
    const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    return match?.[1]?.replace(/['"]/g, '') || null;
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  private async postJson<T>(path: string, body: any, extraHeaders?: Record<string, string>): Promise<T> {
    return this.fetchWithHandling<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: extraHeaders,
    });
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.fetchWithHandling<T>(path, {
      method: 'GET',
    });
  }

  // API Methods

  async ping(): Promise<ServiceInfo> {
    return this.getJson<ServiceInfo>('/');
  }

  async sshLogin(connection: SiteConnection): Promise<LoginResponse> {
    return this.postJson<LoginResponse>('/ssh/login', connection);
  }

  async getSiteInfo(siteId: string): Promise<SiteInfo> {
    return this.getJson<SiteInfo>(`/sites/${siteId}`);
  }

  async createBackup(config: SiteConfig): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/backup', config);
  }

  async getWpStatus(config: SiteConfig): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/wp-status', config);
  }

  async updateWordPress(config: SiteConfig): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/update', config);
  }

  async checkSslExpiry(domain: string, site: SiteConfig): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/ssl-expiry', { req: { domain }, site });
  }

  async healthCheck(
    url: string, 
    keyword: string, 
    screenshot: boolean, 
    outPath: string, 
    site: SiteConfig
  ): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/healthcheck', {
      req: { url, keyword, screenshot, out_path: outPath },
      site
    });
  }

  async installWordPress(siteId: string, request: WPInstallRequest): Promise<TaskResponse> {
    return this.postJson<TaskResponse>(`/tasks/wp-install/${siteId}`, request);
  }

  async hardReset(
    wpPath: string,
    domain: string,
    site: SiteConfig,
    options: {
      purgeStack?: boolean;
      resetUfw?: boolean;
      force?: boolean;
      reportPath?: string;
    } = {}
  ): Promise<TaskResponse> {
    const headers = this.settings.resetToken ? {
      'Authorization': `Bearer ${this.settings.resetToken}`,
      'X-Reset-Token': this.settings.resetToken,
    } : {};

    return this.postJson<TaskResponse>('/tasks/wp-reset', {
      req: {
        wp_path: wpPath,
        domain,
        purge_stack: options.purgeStack ?? true,
        reset_ufw: options.resetUfw ?? true,
        force: options.force ?? true,
        report_path: options.reportPath ?? '/tmp/wp_rollback_report.json',
      },
      site
    }, headers);
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    return this.getJson<TaskStatus>(`/tasks/${taskId}`);
  }

  // New endpoint methods

  async domainSslCollect(domain: string, reportEmail?: string): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/domain-ssl-collect', {
      domain,
      report_email: reportEmail,
    });
  }

  async wpOutdatedFetch(url: string, reportEmail?: string): Promise<TaskResponse> {
    const auth = this.settings.defaultAuth;
    const body: any = { url };
    if (auth?.username && auth?.password) {
      body.basic_auth = `${auth.username}:${auth.password}`;
    }
    if (reportEmail) {
      body.report_email = reportEmail;
    }
    return this.postJson<TaskResponse>('/tasks/wp-outdated-fetch', body);
  }

  async updatePlugins(
    baseUrl: string,
    plugins?: string[],
    autoSelectOutdated: boolean = true,
    blocklist: string[] = [],
    headers?: Record<string, string>,
    auth?: { username: string; password: string },
    reportEmail?: string
  ): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/wp-update/plugins', {
      base_url: baseUrl,
      plugins,
      auto_select_outdated: autoSelectOutdated,
      blocklist,
      headers,
      auth,
      report_email: reportEmail,
    });
  }

  // Enhanced plugin update with normalization and debugging
  async updatePluginsWithNormalization(
    baseUrl: string,
    plugins: string[],
    availablePlugins: PluginInfo[] = [],
    autoSelectOutdated: boolean = true,
    blocklist: string[] = [],
    headers?: Record<string, string>,
    auth?: { username: string; password: string },
    reportEmail?: string
  ): Promise<TaskResponse & { debugInfo?: NormalizationDebugInfo }> {
    // Normalize plugin names/slugs to plugin_file format
    const { normalized, debugInfo } = normalizePluginList(plugins, availablePlugins);
    
    // console.log('=== PLUGIN NORMALIZATION DEBUG ===');
    // console.log('Input plugins:', plugins);
    // console.log('Available plugins:', availablePlugins.length);
    // console.log('Normalization results:', debugInfo.results);
    // console.log('Final plugin files:', normalized);
    // console.log('===================================');

    // Use the normalized plugin files
    const response = await this.postJson<TaskResponse>('/tasks/wp-update/plugins', {
      base_url: baseUrl,
      plugins: normalized,
      auto_select_outdated: autoSelectOutdated,
      blocklist,
      headers,
      auth,
      report_email: reportEmail,
    });

    // Return response with debug info
    return {
      ...response,
      debugInfo,
    };
  }

  // Enhanced method to try multiple plugin update formats
  async updatePluginsRobust(
    baseUrl: string,
    plugins: string[],
    availablePlugins: PluginInfo[] = [],
    autoSelectOutdated: boolean = true,
    blocklist: string[] = [],
    headers?: Record<string, string>,
    auth?: { username: string; password: string },
    reportEmail?: string
  ): Promise<TaskResponse & { attempts?: any[]; debugInfo?: NormalizationDebugInfo }> {
    const attempts: any[] = [];
    
    // First normalize the plugins
    const { normalized, debugInfo } = normalizePluginList(plugins, availablePlugins);
    
    // console.log('=== ROBUST PLUGIN UPDATE ATTEMPT ===');
    // console.log('Original plugins:', plugins);
    // console.log('Normalized plugins:', normalized);
    
    const basePayload = {
      base_url: baseUrl,
      auto_select_outdated: autoSelectOutdated,
      blocklist,
      headers,
      auth,
      report_email: reportEmail,
    };

    // Attempt 1: Standard format with normalized plugins
    try {
      // console.log('Attempt 1: Standard format with normalized plugins');
      const payload = {
        ...basePayload,
        plugins: normalized,
      };
      attempts.push({ format: 'standard_normalized', payload });
      
      const response = await this.postJson<TaskResponse>('/tasks/wp-update/plugins', payload);
      // console.log('Attempt 1 successful:', response);
      
      return {
        ...response,
        attempts,
        debugInfo,
      };
    } catch (error) {
      // console.log('Attempt 1 failed:', error);
      attempts[attempts.length - 1].error = String(error);
    }

    // Attempt 2: Array format
    try {
      // console.log('Attempt 2: Array format');
      const payload = {
        ...basePayload,
        plugins: normalized.map(plugin => ({ plugin })),
      };
      attempts.push({ format: 'array_format', payload });
      
      const response = await this.postJson<TaskResponse>('/tasks/wp-update/plugins', payload);
      // console.log('Attempt 2 successful:', response);
      
      return {
        ...response,
        attempts,
        debugInfo,
      };
    } catch (error) {
      // console.log('Attempt 2 failed:', error);
      attempts[attempts.length - 1].error = String(error);
    }

    // Attempt 3: Original input format (fallback)
    try {
      // console.log('Attempt 3: Original input format');
      const payload = {
        ...basePayload,
        plugins: plugins,
      };
      attempts.push({ format: 'original_format', payload });
      
      const response = await this.postJson<TaskResponse>('/tasks/wp-update/plugins', payload);
      // console.log('Attempt 3 successful:', response);
      
      return {
        ...response,
        attempts,
        debugInfo,
      };
    } catch (error) {
      // console.log('Attempt 3 failed:', error);
      attempts[attempts.length - 1].error = String(error);
      
      // All attempts failed, throw the last error
      throw new Error(`All plugin update attempts failed. Last error: ${error}`);
    }
  }

  async updateCore(
    baseUrl: string,
    precheck: boolean = true,
    headers?: Record<string, string>,
    auth?: { username: string; password: string },
    reportEmail?: string
  ): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/wp-update/core', {
      base_url: baseUrl,
      precheck,
      headers,
      auth,
      report_email: reportEmail,
    });
  }

  async updateAll(
    baseUrl: string,
    includePlugins: boolean = true,
    includeCore: boolean = true,
    precheckCore: boolean = true,
    blocklist: string[] = [],
    headers?: Record<string, string>,
    auth?: { username: string; password: string },
    reportEmail?: string
  ): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/wp-update/all', {
      base_url: baseUrl,
      include_plugins: includePlugins,
      include_core: includeCore,
      precheck_core: precheckCore,
      blocklist,
      headers,
      auth,
      report_email: reportEmail,
    });
  }

  async backupDb(
    config: SiteConfig & {
      out_dir?: string;
      download?: boolean;
      filename?: string;
      wait_timeout?: number;
    }
  ): Promise<TaskResponse | { downloaded: boolean; filename: string }> {
    return this.postJson('/tasks/backup/db', config);
  }

  async backupContent(
    config: SiteConfig & {
      out_dir?: string;
      download?: boolean;
      filename?: string;
      wait_timeout?: number;
    }
  ): Promise<TaskResponse | { downloaded: boolean; filename: string }> {
    return this.postJson('/tasks/backup/content', config);
  }

  // Task polling helper
  async pollTask(taskId: string, onUpdate?: (status: TaskStatus) => void): Promise<TaskStatus> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const status = await this.getTaskStatus(taskId);
          onUpdate?.(status);

          if (status.state === 'SUCCESS' || status.state === 'FAILURE') {
            resolve(status);
            return;
          }

          setTimeout(poll, 1200); // Faster polling for better UX
        } catch (error) {
          reject(error);
        }
      };
      poll();
    });
  }

  // Enhanced polling with timeout
  async pollTaskWithTimeout(
    taskId: string, 
    options: {
      intervalMs?: number;
      timeoutMs?: number;
      onUpdate?: (status: TaskStatus) => void;
    } = {}
  ): Promise<TaskStatus> {
    const { intervalMs = 1200, timeoutMs = 600000, onUpdate } = options; // 10 min timeout
    
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const poll = async () => {
        try {
          if (Date.now() - startTime > timeoutMs) {
            reject(new Error('Task polling timeout - still running in background'));
            return;
          }

          const status = await this.getTaskStatus(taskId);
          onUpdate?.(status);

          if (status.state === 'SUCCESS' || status.state === 'FAILURE') {
            resolve(status);
            return;
          }

          setTimeout(poll, intervalMs);
        } catch (error) {
          reject(error);
        }
      };
      poll();
    });
  }

  // Plugin update with task polling and verification
  async updatePluginWithPolling(
    baseUrl: string,
    pluginFile: string,
    auth: { username: string; password: string },
    onProgress?: (status: string) => void
  ): Promise<{
    success: boolean;
    updated: boolean;
    message: string;
    details?: string;
    taskResult?: any;
  }> {
    try {
      console.log('=== PLUGIN UPDATE WITH POLLING ===');
      console.log('Plugin file:', pluginFile);
      console.log('Base URL:', baseUrl);
      console.log('Auth:', { username: auth.username, password: auth.password ? '[SET]' : '[NOT SET]' });

      // 1. Enqueue the update task
      onProgress?.('Enqueueing update...');
      const enqueueResponse = await this.updatePlugins(
        baseUrl,
        [pluginFile],
        false, // Don't auto-select outdated
        [], // No blocklist
        undefined, // No custom headers
        auth
      );

      console.log('=== ENQUEUE RESPONSE ===');
      console.log('Task ID:', enqueueResponse.task_id);
      console.log('Status:', enqueueResponse.status);

      // 2. Poll the task until completion
      onProgress?.('Updating plugin...');
      const taskResult = await this.pollTaskWithTimeout(enqueueResponse.task_id, {
        onUpdate: (status) => {
          if (status.state === 'STARTED') {
            onProgress?.('Update in progress...');
          }
        }
      });

      console.log('=== TASK RESULT ===');
      console.log('State:', taskResult.state);
      console.log('Result:', taskResult.result);

      // 3. Handle task failure
      if (taskResult.state === 'FAILURE') {
        return {
          success: false,
          updated: false,
          message: 'Plugin update failed',
          details: taskResult.info || 'Unknown error occurred',
          taskResult
        };
      }

      // 4. Verify actual update from result
      const pluginsResult = taskResult.result?.plugins?.result;
      
      // Check per_plugin results first (preferred)
      if (pluginsResult?.per_plugin) {
        const pluginResult = pluginsResult.per_plugin.find(
          (p: any) => p.plugin_file === pluginFile
        );
        
        if (pluginResult) {
          const updated = pluginResult.updated === true;
          const details = this.extractUpdateDetails(pluginResult);
          
          return {
            success: true,
            updated,
            message: updated 
              ? 'Plugin updated successfully' 
              : 'Plugin update failed',
            details,
            taskResult
          };
        }
      }

      // Fallback: Check if we have post_status or other indicators
      if (pluginsResult) {
        return {
          success: true,
          updated: true, // Assume success if we got a result
          message: 'Plugin update completed',
          details: 'Update completed but verification details unavailable',
          taskResult
        };
      }

      // No clear result
      return {
        success: false,
        updated: false,
        message: 'Plugin update status unclear',
        details: 'No plugin update result found in task response',
        taskResult
      };

    } catch (error) {
      console.error('Plugin update with polling failed:', error);
      
      if (error instanceof Error && error.message.includes('timeout')) {
        return {
          success: false,
          updated: false,
          message: 'Update timeout',
          details: 'Still running in background; refresh to check status',
        };
      }

      return {
        success: false,
        updated: false,
        message: 'Plugin update failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Bulk plugin update with polling and verification
  async updateAllPluginsWithPolling(
    baseUrl: string,
    pluginFiles: string[],
    auth: { username: string; password: string },
    onProgress?: (status: string) => void
  ): Promise<{
    success: boolean;
    summary: string;
    results: Array<{
      pluginFile: string;
      updated: boolean;
      message: string;
      details?: string;
    }>;
    taskResult?: any;
  }> {
    try {
      console.log('=== BULK PLUGIN UPDATE WITH POLLING ===');
      console.log('Plugin files:', pluginFiles);
      console.log('Base URL:', baseUrl);
      console.log('Auth:', { username: auth.username, password: auth.password ? '[SET]' : '[NOT SET]' });

      // 1. Enqueue the bulk update task
      onProgress?.('Enqueueing bulk update...');
      const enqueueResponse = await this.updatePlugins(
        baseUrl,
        pluginFiles,
        false, // Don't auto-select outdated
        [], // No blocklist
        undefined, // No custom headers
        auth
      );

      console.log('=== BULK ENQUEUE RESPONSE ===');
      console.log('Task ID:', enqueueResponse.task_id);
      console.log('Status:', enqueueResponse.status);

      // 2. Poll the task until completion
      onProgress?.('Updating plugins...');
      const taskResult = await this.pollTaskWithTimeout(enqueueResponse.task_id, {
        onUpdate: (status) => {
          if (status.state === 'STARTED') {
            onProgress?.('Bulk update in progress...');
          }
        }
      });

      console.log('=== BULK TASK RESULT ===');
      console.log('State:', taskResult.state);
      console.log('Result:', taskResult.result);

      // 3. Handle task failure
      if (taskResult.state === 'FAILURE') {
        return {
          success: false,
          summary: 'Bulk plugin update failed',
          results: pluginFiles.map(file => ({
            pluginFile: file,
            updated: false,
            message: 'Failed',
            details: taskResult.info || 'Unknown error occurred'
          })),
          taskResult
        };
      }

      // 4. Process results for each plugin
      const pluginsResult = taskResult.result?.plugins?.result;
      const results: Array<{
        pluginFile: string;
        updated: boolean;
        message: string;
        details?: string;
      }> = [];

      let successCount = 0;
      let failureCount = 0;

      // Check per_plugin results if available
      if (pluginsResult?.per_plugin) {
        pluginFiles.forEach(pluginFile => {
          const pluginResult = pluginsResult.per_plugin.find(
            (p: any) => p.plugin_file === pluginFile
          );
          
          if (pluginResult) {
            const updated = pluginResult.updated === true;
            const details = this.extractUpdateDetails(pluginResult);
            
            results.push({
              pluginFile,
              updated,
              message: updated ? 'Updated' : 'Failed',
              details
            });

            if (updated) successCount++;
            else failureCount++;
          } else {
            results.push({
              pluginFile,
              updated: false,
              message: 'Not found in results',
              details: 'Plugin not found in update results'
            });
            failureCount++;
          }
        });
      } else {
        // Fallback: assume all succeeded if we got a result
        pluginFiles.forEach(pluginFile => {
          results.push({
            pluginFile,
            updated: true,
            message: 'Updated',
            details: 'Update completed'
          });
          successCount++;
        });
      }

      const summary = `${successCount} updated, ${failureCount} failed`;

      return {
        success: true,
        summary,
        results,
        taskResult
      };

    } catch (error) {
      console.error('Bulk plugin update with polling failed:', error);
      
      if (error instanceof Error && error.message.includes('timeout')) {
        return {
          success: false,
          summary: 'Update timeout',
          results: pluginFiles.map(file => ({
            pluginFile: file,
            updated: false,
            message: 'Timeout',
            details: 'Still running in background; refresh to check status'
          }))
        };
      }

      return {
        success: false,
        summary: 'Bulk update failed',
        results: pluginFiles.map(file => ({
          pluginFile: file,
          updated: false,
          message: 'Failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        }))
      };
    }
  }

  // Extract meaningful details from plugin update result
  private extractUpdateDetails(pluginResult: any): string {
    // Try to get a meaningful message from the response
    const jsonBody = pluginResult.json?.body;
    const formBody = pluginResult.form?.body;
    
    if (jsonBody && typeof jsonBody === 'string' && jsonBody.length > 0) {
      return jsonBody.substring(0, 120);
    }
    
    if (formBody && typeof formBody === 'string' && formBody.length > 0) {
      return formBody.substring(0, 120);
    }
    
    if (pluginResult.json?.status) {
      return `HTTP ${pluginResult.json.status}`;
    }
    
    return pluginResult.updated ? 'Successfully updated' : 'Update failed';
  }
}

export const apiService = new ApiService();