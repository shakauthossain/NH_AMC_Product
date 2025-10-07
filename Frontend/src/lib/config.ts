// Environment configuration
interface Config {
  apiBaseUrl: string;
  environment: string;
}

function getConfig(): Config {
  // Get environment variables with fallbacks
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'https://amcbackend.hellonotionhive.com';
  const environment = import.meta.env.VITE_APP_ENV || 'production';

  return {
    apiBaseUrl,
    environment,
  };
}

export const config = getConfig();