// Configuration complète d'accessibilité WCAG 2.1 AA
// =======================================================

// Configuration des règles d'accessibilité
export const wcagConfig = {
  level: 'AA', // AA ou AAA
  version: '2.1',
  
  // Règles principales
  rules: {
    // Perceptible
    colorContrast: {
      enabled: true,
      minRatio: 4.5, // AA: 4.5:1, AAA: 7:1
      largeTextMinRatio: 3.0 // AA: 3:1, AAA: 4.5:1
    },
    
    alternativeText: {
      enabled: true,
      requireAlt: true,
      decorativeAllowed: true // aria-hidden="true" ou alt=""
    },
    
    audioVideoCaptions: {
      enabled: true,
      requireCaptions: true,
      requireTranscripts: true
    },
    
    // Opérable  
    keyboardNavigation: {
      enabled: true,
      requireTabIndex: true,
      requireVisibleFocus: true,
      skipLinks: true
    },
    
    timingAdjustments: {
      enabled: true,
      requireExtension: true,
      minimumTime: 20000 // 20 secondes minimum
    },
    
    seizureThreshold: {
      enabled: true,
      maxFlashRate: 3 // 3 clignotements par seconde max
    },
    
    // Compréhensible
    readableText: {
      enabled: true,
      language: 'fr',
      readingLevel: 'simple',
      unusualWords: 'define'
    },
    
    predictableInterface: {
      enabled: true,
      consistentNavigation: true,
      consistentIdentification: true
    },
    
    inputAssistance: {
      enabled: true,
      errorIdentification: true,
      labelInstructions: true,
      errorSuggestion: true,
      errorPrevention: true
    },
    
    // Robuste
    codeValidation: {
      enabled: true,
      validHTML: true,
      uniqueIds: true
    },
    
    assistiveTechnology: {
      enabled: true,
      ariaCompliant: true,
      screenReaderCompatible: true
    }
  }
};

// Configuration axe-core pour tests automatisés
export const axeConfig = {
  rules: {
    // Règles activées
    'aria-allowed-attr': { enabled: true },
    'aria-hidden-body': { enabled: true },
    'aria-hidden-focus': { enabled: true },
    'aria-input-field-name': { enabled: true },
    'aria-label': { enabled: true },
    'aria-labelledby': { enabled: true },
    'aria-required-attr': { enabled: true },
    'aria-required-children': { enabled: true },
    'aria-required-parent': { enabled: true },
    'aria-roledescription': { enabled: true },
    'aria-roles': { enabled: true },
    'aria-valid-attr': { enabled: true },
    'aria-valid-attr-value': { enabled: true },
    'button-name': { enabled: true },
    'color-contrast': { enabled: true },
    'document-title': { enabled: true },
    'duplicate-id': { enabled: true },
    'focus-order-semantics': { enabled: true },
    'form-field-multiple-labels': { enabled: true },
    'frame-title': { enabled: true },
    'heading-order': { enabled: true },
    'html-has-lang': { enabled: true },
    'html-lang-valid': { enabled: true },
    'image-alt': { enabled: true },
    'input-image-alt': { enabled: true },
    'keyboard': { enabled: true },
    'label': { enabled: true },
    'landmark-banner-is-top-level': { enabled: true },
    'landmark-complementary-is-top-level': { enabled: true },
    'landmark-contentinfo-is-top-level': { enabled: true },
    'landmark-main-is-top-level': { enabled: true },
    'landmark-no-duplicate-banner': { enabled: true },
    'landmark-no-duplicate-contentinfo': { enabled: true },
    'landmark-one-main': { enabled: true },
    'link-name': { enabled: true },
    'list': { enabled: true },
    'listitem': { enabled: true },
    'page-has-heading-one': { enabled: true },
    'region': { enabled: true },
    'skip-link': { enabled: true },
    'tabindex': { enabled: true }
  },
  
  tags: ['wcag2a', 'wcag2aa', 'wcag21aa'],
  
  // Contexte d'inclusion/exclusion
  include: [['body']],
  exclude: [
    ['.skip-test'],
    ['[data-testid="ignore-accessibility"]']
  ]
};

// Utilitaires d'accessibilité
export class AccessibilityUtils {
  
  // Vérifier le contraste des couleurs
  static checkColorContrast(foreground, background) {
    const getRGB = (color) => {
      const match = color.match(/\d+/g);
      return match ? match.map(Number) : [0, 0, 0];
    };
    
    const getLuminance = (r, g, b) => {
      const [rs, gs, bs] = [r, g, b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    };
    
    const [r1, g1, b1] = getRGB(foreground);
    const [r2, g2, b2] = getRGB(background);
    
    const lum1 = getLuminance(r1, g1, b1);
    const lum2 = getLuminance(r2, g2, b2);
    
    const ratio = (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
    
    return {
      ratio: Math.round(ratio * 100) / 100,
      passesAA: ratio >= 4.5,
      passesAAA: ratio >= 7,
      passesAALarge: ratio >= 3,
      passesAAALarge: ratio >= 4.5
    };
  }
  
  // Générer des couleurs accessibles
  static generateAccessibleColors(baseColor, level = 'AA') {
    const minRatio = level === 'AAA' ? 7 : 4.5;
    const colors = [];
    
    // Logique de génération de couleurs avec ratio suffisant
    // Implémentation simplifiée
    colors.push({
      foreground: '#000000',
      background: baseColor,
      ratio: this.checkColorContrast('#000000', baseColor).ratio
    });
    
    colors.push({
      foreground: '#FFFFFF',
      background: baseColor,
      ratio: this.checkColorContrast('#FFFFFF', baseColor).ratio
    });
    
    return colors.filter(color => color.ratio >= minRatio);
  }
  
  // Vérifier la structure des titres
  static checkHeadingStructure(container = document) {
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const structure = [];
    let previousLevel = 0;
    
    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName.substring(1));
      const text = heading.textContent.trim();
      
      structure.push({
        element: heading,
        level,
        text,
        index,
        valid: level <= previousLevel + 1
      });
      
      previousLevel = level;
    });
    
    return {
      headings: structure,
      isValid: structure.every(h => h.valid),
      errors: structure.filter(h => !h.valid)
    };
  }
  
  // Vérifier les labels de formulaire
  static checkFormLabels(container = document) {
    const inputs = container.querySelectorAll('input, select, textarea');
    const results = [];
    
    inputs.forEach(input => {
      const id = input.id;
      const type = input.type;
      const name = input.name;
      
      let hasLabel = false;
      let labelText = '';
      let method = 'none';
      
      // Vérifier label avec for
      if (id) {
        const label = container.querySelector(`label[for="${id}"]`);
        if (label) {
          hasLabel = true;
          labelText = label.textContent.trim();
          method = 'explicit-label';
        }
      }
      
      // Vérifier label parent
      if (!hasLabel) {
        const parentLabel = input.closest('label');
        if (parentLabel) {
          hasLabel = true;
          labelText = parentLabel.textContent.trim();
          method = 'implicit-label';
        }
      }
      
      // Vérifier aria-label
      if (!hasLabel && input.getAttribute('aria-label')) {
        hasLabel = true;
        labelText = input.getAttribute('aria-label');
        method = 'aria-label';
      }
      
      // Vérifier aria-labelledby
      if (!hasLabel && input.getAttribute('aria-labelledby')) {
        const labelId = input.getAttribute('aria-labelledby');
        const labelElement = container.querySelector(`#${labelId}`);
        if (labelElement) {
          hasLabel = true;
          labelText = labelElement.textContent.trim();
          method = 'aria-labelledby';
        }
      }
      
      results.push({
        element: input,
        id,
        type,
        name,
        hasLabel,
        labelText,
        method,
        isValid: hasLabel || type === 'hidden' || type === 'submit' || type === 'button'
      });
    });
    
    return {
      inputs: results,
      isValid: results.every(r => r.isValid),
      errors: results.filter(r => !r.isValid)
    };
  }
  
  // Vérifier la navigation au clavier
  static checkKeyboardNavigation(container = document) {
    const focusableElements = container.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const results = [];
    
    focusableElements.forEach((element, index) => {
      const tabIndex = element.getAttribute('tabindex');
      const isVisible = element.offsetParent !== null;
      const hasSkipToContent = element.textContent.toLowerCase().includes('skip');
      
      results.push({
        element,
        index,
        tabIndex: tabIndex ? parseInt(tabIndex) : 0,
        isVisible,
        hasSkipToContent,
        isValid: isVisible && (tabIndex === null || parseInt(tabIndex) >= 0)
      });
    });
    
    return {
      focusableElements: results,
      tabOrder: results.filter(r => r.isVisible).sort((a, b) => a.tabIndex - b.tabIndex),
      hasSkipLinks: results.some(r => r.hasSkipToContent),
      isValid: results.every(r => r.isValid)
    };
  }
  
  // Simuler la navigation au clavier
  static simulateKeyboardNavigation(container = document) {
    const focusableElements = this.checkKeyboardNavigation(container).tabOrder;
    let currentIndex = 0;
    
    return {
      next: () => {
        if (currentIndex < focusableElements.length - 1) {
          currentIndex++;
          focusableElements[currentIndex].element.focus();
          return focusableElements[currentIndex];
        }
        return null;
      },
      
      previous: () => {
        if (currentIndex > 0) {
          currentIndex--;
          focusableElements[currentIndex].element.focus();
          return focusableElements[currentIndex];
        }
        return null;
      },
      
      current: () => focusableElements[currentIndex],
      
      reset: () => {
        currentIndex = 0;
        if (focusableElements.length > 0) {
          focusableElements[0].element.focus();
        }
      }
    };
  }
}

// Composants d'accessibilité réutilisables
export const AccessibilityComponents = {
  
  // Skip Link
  SkipLink: ({ href = '#main-content', children = 'Aller au contenu principal' }) => `
    <a 
      href="${href}" 
      class="skip-link"
      style="
        position: absolute;
        left: -9999px;
        width: 1px;
        height: 1px;
        overflow: hidden;
      "
      onfocus="this.style.left='0'; this.style.width='auto'; this.style.height='auto';"
      onblur="this.style.left='-9999px'; this.style.width='1px'; this.style.height='1px';"
    >
      ${children}
    </a>
  `,
  
  // Landmark regions
  LandmarkRegions: {
    header: (content) => `<header role="banner">${content}</header>`,
    nav: (content, label) => `<nav role="navigation" aria-label="${label}">${content}</nav>`,
    main: (content) => `<main role="main" id="main-content">${content}</main>`,
    aside: (content, label) => `<aside role="complementary" aria-label="${label}">${content}</aside>`,
    footer: (content) => `<footer role="contentinfo">${content}</footer>`
  },
  
  // Announcements pour screen readers
  LiveRegion: ({ level = 'polite', content = '' }) => `
    <div 
      aria-live="${level}" 
      aria-atomic="true" 
      class="sr-only"
      style="
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      "
    >
      ${content}
    </div>
  `
};

// Tests d'accessibilité automatisés
export class AccessibilityTester {
  
  constructor(config = axeConfig) {
    this.config = config;
    this.results = [];
  }
  
  // Test avec axe-core
  async runAxeTest(element = document, options = {}) {
    const axe = await import('axe-core');
    
    try {
      const results = await axe.run(element, {
        ...this.config,
        ...options
      });
      
      this.results.push({
        type: 'axe',
        timestamp: new Date().toISOString(),
        results
      });
      
      return results;
    } catch (error) {
      console.error('Erreur lors du test axe:', error);
      throw error;
    }
  }
  
  // Test de contraste
  runContrastTest(container = document) {
    const elements = container.querySelectorAll('*');
    const results = [];
    
    elements.forEach(element => {
      const styles = window.getComputedStyle(element);
      const color = styles.color;
      const backgroundColor = styles.backgroundColor;
      
      if (color && backgroundColor && backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const contrast = AccessibilityUtils.checkColorContrast(color, backgroundColor);
        
        if (!contrast.passesAA) {
          results.push({
            element,
            color,
            backgroundColor,
            ratio: contrast.ratio,
            required: 4.5
          });
        }
      }
    });
    
    return results;
  }
  
  // Test de structure
  runStructureTest(container = document) {
    const headingTest = AccessibilityUtils.checkHeadingStructure(container);
    const formTest = AccessibilityUtils.checkFormLabels(container);
    const keyboardTest = AccessibilityUtils.checkKeyboardNavigation(container);
    
    return {
      headings: headingTest,
      forms: formTest,
      keyboard: keyboardTest,
      isValid: headingTest.isValid && formTest.isValid && keyboardTest.isValid
    };
  }
  
  // Générer rapport complet
  async generateReport(container = document) {
    const axeResults = await this.runAxeTest(container);
    const contrastResults = this.runContrastTest(container);
    const structureResults = this.runStructureTest(container);
    
    return {
      timestamp: new Date().toISOString(),
      summary: {
        violations: axeResults.violations.length,
        passes: axeResults.passes.length,
        incomplete: axeResults.incomplete.length,
        contrastIssues: contrastResults.length,
        structureValid: structureResults.isValid
      },
      axe: axeResults,
      contrast: contrastResults,
      structure: structureResults,
      score: this.calculateScore(axeResults, contrastResults, structureResults)
    };
  }
  
  // Calculer score d'accessibilité
  calculateScore(axeResults, contrastResults, structureResults) {
    let score = 100;
    
    // Déductions pour violations
    score -= axeResults.violations.length * 10;
    score -= contrastResults.length * 5;
    score -= structureResults.headings.errors.length * 3;
    score -= structureResults.forms.errors.length * 5;
    
    return Math.max(0, Math.min(100, score));
  }
}

// Export configuration principale
export default {
  wcag: wcagConfig,
  axe: axeConfig,
  utils: AccessibilityUtils,
  components: AccessibilityComponents,
  tester: AccessibilityTester
};