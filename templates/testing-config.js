// Configuration complète de tests - Jest + Playwright + Coverage
// ================================================================

// Configuration Jest pour tests unitaires et d'intégration
export const jestConfig = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  
  // Patterns de fichiers
  testMatch: [
    '**/__tests__/**/*.{js,jsx,ts,tsx}',
    '**/?(*.)+(spec|test).{js,jsx,ts,tsx}'
  ],
  
  // Extensions et transformations
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
    '^.+\\.css$': 'jest-transform-css',
    '^.+\\.(jpg|jpeg|png|gif|webp|svg)$': 'jest-transform-file'
  },
  
  // Module resolution
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1'
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  setupFiles: ['<rootDir>/tests/env.setup.ts'],
  
  // Coverage configuration
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx,js,jsx}',
    '!src/**/*.d.ts',
    '!src/**/index.{ts,tsx,js,jsx}',
    '!src/**/*.stories.{ts,tsx,js,jsx}',
    '!src/**/*.config.{ts,tsx,js,jsx}',
    '!src/types/**/*'
  ],
  
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'text-summary', 
    'html',
    'lcov',
    'json',
    'json-summary'
  ],
  
  // Seuils de couverture
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './src/components/': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    './src/services/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  
  // Reporters personnalisés
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'test-results',
      outputName: 'junit.xml'
    }],
    ['jest-html-reporters', {
      publicPath: 'test-results',
      filename: 'test-report.html'
    }]
  ],
  
  // Configuration timeout
  testTimeout: 10000,
  
  // Cache
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  
  // Verbose output
  verbose: true,
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/.next/',
    '<rootDir>/e2e/'
  ],
  
  // Global variables
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  }
};

// Configuration Playwright pour tests E2E
export const playwrightConfig = {
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }]
  ],
  
  use: {
    // Base URL
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    
    // Browser context
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Timeouts
    actionTimeout: 10000,
    navigationTimeout: 30000,
    
    // Locale and timezone
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris'
  },
  
  // Projects (browsers)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] }
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] }
    }
  ],
  
  // Test server
  webServer: {
    command: 'npm run start:test',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
};

// Utilitaires de test
export class TestUtils {
  
  // Mock pour API calls
  static mockApiCall(endpoint, response, status = 200) {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(response),
        text: () => Promise.resolve(JSON.stringify(response))
      })
    );
  }
  
  // Mock pour localStorage
  static mockLocalStorage() {
    const localStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock
    });
    return localStorageMock;
  }
  
  // Mock pour sessionStorage
  static mockSessionStorage() {
    const sessionStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn()
    };
    Object.defineProperty(window, 'sessionStorage', {
      value: sessionStorageMock
    });
    return sessionStorageMock;
  }
  
  // Mock pour IntersectionObserver
  static mockIntersectionObserver() {
    global.IntersectionObserver = jest.fn(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
      unobserve: jest.fn()
    }));
  }
  
  // Mock pour ResizeObserver
  static mockResizeObserver() {
    global.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
      unobserve: jest.fn()
    }));
  }
  
  // Helper pour attendre une condition
  static async waitFor(condition, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }
  
  // Helper pour simuler des événements
  static fireEvent(element, eventType, eventInit = {}) {
    const event = new Event(eventType, eventInit);
    element.dispatchEvent(event);
    return event;
  }
  
  // Helper pour nettoyer après les tests
  static cleanup() {
    // Nettoyer les mocks
    jest.clearAllMocks();
    jest.restoreAllMocks();
    
    // Nettoyer le DOM
    document.body.innerHTML = '';
    
    // Nettoyer les timers
    jest.clearAllTimers();
  }
}

// Configuration pour tests d'accessibilité
export const accessibilityTestConfig = {
  // Configuration axe-core
  axeConfig: {
    rules: {
      // Règles strictes pour l'accessibilité
      'color-contrast': { enabled: true },
      'keyboard-navigation': { enabled: true },
      'aria-labels': { enabled: true },
      'heading-order': { enabled: true },
      'landmark-roles': { enabled: true }
    },
    tags: ['wcag2a', 'wcag2aa', 'wcag21aa']
  },
  
  // Seuils d'acceptation
  thresholds: {
    violations: 0,
    incomplete: 0
  }
};

// Configuration pour tests de performance
export const performanceTestConfig = {
  lighthouse: {
    ci: {
      collect: {
        url: ['http://localhost:3000'],
        settings: {
          chromeFlags: '--no-sandbox'
        }
      },
      assert: {
        assertions: {
          'categories:performance': ['error', { minScore: 0.9 }],
          'categories:accessibility': ['error', { minScore: 0.9 }],
          'categories:best-practices': ['error', { minScore: 0.9 }],
          'categories:seo': ['error', { minScore: 0.9 }],
          'categories:pwa': ['error', { minScore: 0.8 }]
        }
      },
      upload: {
        target: 'temporary-public-storage'
      }
    }
  }
};

// Scripts de test personnalisés
export const testScripts = {
  // Test de smoke
  smokeTest: async () => {
    const response = await fetch('/health');
    if (!response.ok) {
      throw new Error('Health check failed');
    }
    
    const health = await response.json();
    if (health.status !== 'healthy') {
      throw new Error('Application unhealthy');
    }
    
    console.log('✅ Smoke test passed');
  },
  
  // Test de charge simple
  loadTest: async (url, concurrent = 10, requests = 100) => {
    const promises = [];
    const startTime = Date.now();
    
    for (let i = 0; i < concurrent; i++) {
      promises.push(
        (async () => {
          for (let j = 0; j < requests / concurrent; j++) {
            await fetch(url);
          }
        })()
      );
    }
    
    await Promise.all(promises);
    const duration = Date.now() - startTime;
    const rps = requests / (duration / 1000);
    
    console.log(`✅ Load test: ${requests} requests in ${duration}ms (${rps.toFixed(2)} RPS)`);
  }
};

// Export de la configuration principale
export default {
  jest: jestConfig,
  playwright: playwrightConfig,
  accessibility: accessibilityTestConfig,
  performance: performanceTestConfig,
  utils: TestUtils,
  scripts: testScripts
};