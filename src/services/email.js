/**
 * Service Email - Framework d'Analyse Technique
 * 
 * Implémente les bonnes pratiques:
 * - Configuration SMTP sécurisée
 * - Templates d'emails réutilisables
 * - Gestion des erreurs et retry logic
 * - Validation des adresses email
 * - Rate limiting pour éviter le spam
 */

import nodemailer from 'nodemailer';
import { CacheService } from './cache.js';

class EmailService {
  constructor() {
    this.transporter = null;
    this.isInitialized = false;
    this.retryAttempts = 0;
    this.maxRetries = 3;
    
    // Métriques
    this.metrics = {
      sent: 0,
      failed: 0,
      queued: 0
    };
    
    // Rate limiting
    this.rateLimit = {
      window: 60000, // 1 minute
      maxEmails: 10  // 10 emails par minute par défaut
    };
  }

  /**
   * Initialise le service email
   */
  async initialize() {
    try {
      if (!process.env.SMTP_HOST) {
        console.log('⚠️ Configuration SMTP manquante, service email désactivé');
        return;
      }

      // Configuration du transporteur SMTP
      this.transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_PORT === '465', // true pour 465, false pour autres ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        },
        pool: true, // Pool de connexions
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 5,
        
        // Configuration TLS
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
      });

      // Vérification de la connexion
      await this.verifyConnection();
      
      this.isInitialized = true;
      console.log('✅ Service email initialisé');
      
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation du service email:', error);
      
      // Retry logic
      if (this.retryAttempts < this.maxRetries) {
        this.retryAttempts++;
        console.log(`🔄 Tentative de reconnexion email ${this.retryAttempts}/${this.maxRetries}`);
        
        setTimeout(() => {
          this.initialize();
        }, 5000);
        
        return;
      }
      
      console.warn('⚠️ Service email non disponible');
    }
  }

  /**
   * Vérification de la connexion SMTP
   */
  async verifyConnection() {
    try {
      if (!this.transporter) {
        throw new Error('Transporter not initialized');
      }

      await this.transporter.verify();
      console.log('📧 Connexion SMTP vérifiée');
      return true;
      
    } catch (error) {
      console.error('❌ Erreur de vérification SMTP:', error.message);
      throw error;
    }
  }

  /**
   * Validation d'adresse email
   */
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Vérification du rate limiting
   */
  async checkRateLimit(email) {
    try {
      const key = `email_rate_limit:${email}`;
      const count = await CacheService.increment(key, 1, this.rateLimit.window / 1000);
      
      return count <= this.rateLimit.maxEmails;
      
    } catch (error) {
      console.warn('⚠️ Erreur vérification rate limit email:', error.message);
      return true; // En cas d'erreur, permettre l'envoi
    }
  }

  /**
   * Envoi d'email principal
   */
  async sendEmail(options) {
    try {
      if (!this.isInitialized) {
        throw new Error('Email service not initialized');
      }

      // Validation des paramètres obligatoires
      if (!options.to || !options.subject) {
        throw new Error('Missing required email parameters: to, subject');
      }

      // Validation de l'adresse email
      if (!this.validateEmail(options.to)) {
        throw new Error(`Invalid email address: ${options.to}`);
      }

      // Vérification du rate limiting
      const isAllowed = await this.checkRateLimit(options.to);
      if (!isAllowed) {
        throw new Error(`Rate limit exceeded for ${options.to}`);
      }

      // Configuration de l'email
      const mailOptions = {
        from: options.from || process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
        
        // Headers de sécurité
        headers: {
          'X-Mailer': 'Technical Analysis App',
          'X-Priority': options.priority || '3',
          'X-Auto-Response-Suppress': 'All'
        }
      };

      // Envoi avec retry logic
      let lastError;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const result = await this.transporter.sendMail(mailOptions);
          
          this.metrics.sent++;
          
          console.log('📧 Email envoyé avec succès:', {
            to: options.to,
            subject: options.subject,
            messageId: result.messageId,
            attempt
          });
          
          return {
            success: true,
            messageId: result.messageId,
            accepted: result.accepted,
            rejected: result.rejected
          };
          
        } catch (error) {
          lastError = error;
          console.warn(`⚠️ Tentative ${attempt}/${this.maxRetries} échouée:`, error.message);
          
          if (attempt < this.maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
      }
      
      // Toutes les tentatives ont échoué
      this.metrics.failed++;
      throw lastError;
      
    } catch (error) {
      console.error('❌ Erreur envoi email:', error.message);
      this.metrics.failed++;
      throw error;
    }
  }

  /**
   * Templates d'emails prédéfinis
   */
  
  // Email de bienvenue
  async sendWelcomeEmail(userEmail, userName) {
    const subject = 'Bienvenue dans Technical Analysis App';
    const html = this.generateWelcomeTemplate(userName);
    const text = `Bienvenue ${userName}!\n\nVotre compte a été créé avec succès.`;
    
    return await this.sendEmail({
      to: userEmail,
      subject,
      html,
      text
    });
  }

  // Email de réinitialisation de mot de passe
  async sendPasswordResetEmail(userEmail, resetToken, userName) {
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    const subject = 'Réinitialisation de votre mot de passe';
    const html = this.generatePasswordResetTemplate(userName, resetLink);
    const text = `Bonjour ${userName},\n\nCliquez sur ce lien pour réinitialiser votre mot de passe: ${resetLink}`;
    
    return await this.sendEmail({
      to: userEmail,
      subject,
      html,
      text,
      priority: '2' // Haute priorité
    });
  }

  // Email de notification d'alerte
  async sendAlertEmail(adminEmail, alertType, alertData) {
    const subject = `🚨 Alerte Système: ${alertType}`;
    const html = this.generateAlertTemplate(alertType, alertData);
    const text = `Alerte: ${alertType}\n\nDétails: ${JSON.stringify(alertData, null, 2)}`;
    
    return await this.sendEmail({
      to: adminEmail,
      subject,
      html,
      text,
      priority: '1' // Très haute priorité
    });
  }

  // Email de rapport quotidien
  async sendDailyReport(adminEmail, reportData) {
    const subject = `📊 Rapport quotidien - ${new Date().toLocaleDateString('fr-FR')}`;
    const html = this.generateReportTemplate(reportData);
    const text = `Rapport quotidien:\n\n${JSON.stringify(reportData, null, 2)}`;
    
    return await this.sendEmail({
      to: adminEmail,
      subject,
      html,
      text
    });
  }

  /**
   * Générateurs de templates HTML
   */
  
  generateWelcomeTemplate(userName) {
    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bienvenue</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #007bff; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎯 Technical Analysis App</h1>
          </div>
          <div class="content">
            <h2>Bienvenue ${userName}!</h2>
            <p>Votre compte a été créé avec succès. Vous pouvez maintenant accéder à toutes les fonctionnalités de notre plateforme d'analyse technique.</p>
            <p>Fonctionnalités disponibles:</p>
            <ul>
              <li>🔒 Sécurité renforcée</li>
              <li>📊 Monitoring en temps réel</li>
              <li>⚡ Performance optimisée</li>
              <li>♿ Accessibilité WCAG 2.1</li>
            </ul>
            <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 Technical Analysis App - Tous droits réservés</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generatePasswordResetTemplate(userName, resetLink) {
    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Réinitialisation mot de passe</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc3545; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { 
            display: inline-block; 
            background: #007bff; 
            color: white; 
            padding: 12px 24px; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 20px 0; 
          }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔒 Réinitialisation de mot de passe</h1>
          </div>
          <div class="content">
            <h2>Bonjour ${userName},</h2>
            <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
            <p>Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe:</p>
            <a href="${resetLink}" class="button">Réinitialiser le mot de passe</a>
            <div class="warning">
              <strong>⚠️ Important:</strong>
              <ul>
                <li>Ce lien expire dans 1 heure</li>
                <li>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email</li>
                <li>Ne partagez jamais ce lien</li>
              </ul>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateAlertTemplate(alertType, alertData) {
    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Alerte Système</title>
        <style>
          body { font-family: monospace; line-height: 1.4; color: #333; }
          .container { max-width: 800px; margin: 0 auto; padding: 20px; }
          .alert { background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px; }
          .data { background: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; margin: 15px 0; white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="alert">
            <h1>🚨 ALERTE SYSTÈME</h1>
            <h2>Type: ${alertType}</h2>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <p><strong>Environment:</strong> ${process.env.NODE_ENV}</p>
          </div>
          <h3>Détails:</h3>
          <div class="data">${JSON.stringify(alertData, null, 2)}</div>
        </div>
      </body>
      </html>
    `;
  }

  generateReportTemplate(reportData) {
    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Rapport Quotidien</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 800px; margin: 0 auto; padding: 20px; }
          .metric { background: #e9ecef; padding: 15px; margin: 10px 0; border-radius: 5px; }
          .metric h3 { margin: 0 0 10px 0; color: #007bff; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📊 Rapport Quotidien</h1>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString('fr-FR')}</p>
          
          ${Object.entries(reportData).map(([key, value]) => `
            <div class="metric">
              <h3>${key}</h3>
              <p>${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}</p>
            </div>
          `).join('')}
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Statistiques du service
   */
  getStats() {
    return {
      ...this.metrics,
      isInitialized: this.isInitialized,
      retryAttempts: this.retryAttempts,
      rateLimit: this.rateLimit
    };
  }

  /**
   * Fermeture propre du service
   */
  async close() {
    try {
      if (this.transporter) {
        this.transporter.close();
        console.log('✅ Service email fermé');
      }
    } catch (error) {
      console.error('❌ Erreur fermeture service email:', error);
    }
  }
}

// Instance singleton
const emailService = new EmailService();

export { emailService as EmailService };