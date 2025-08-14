// API Service Layer for WordPress Management Dashboard

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

  async wpOutdatedFetch(url: string, headers?: Record<string, string>, reportEmail?: string): Promise<TaskResponse> {
    return this.postJson<TaskResponse>('/tasks/wp-outdated-fetch', {
      url,
      headers,
      report_email: reportEmail,
    });
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

          setTimeout(poll, 2000);
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }
}

export const apiService = new ApiService();