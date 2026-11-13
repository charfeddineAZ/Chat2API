import axios from 'axios'
import { BaseOAuthAdapter } from './base'
import { OAuthResult, OAuthOptions, TokenValidationResult, AdapterConfig } from '../types'

export class GenericTokenAdapter extends BaseOAuthAdapter {
  constructor(config: AdapterConfig) {
    super({
      ...config,
      authMethods: ['manual'],
      loginUrl: config.loginUrl || (config.providerType === 'anthropic' ? 'https://console.anthropic.com/' : 'https://platform.openai.com/'),
      apiUrl: config.apiUrl || (config.providerType === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'),
    })
  }

  async startLogin(_options: OAuthOptions): Promise<OAuthResult> {
    return {
      success: false,
      providerId: this.config.providerId,
      providerType: this.config.providerType,
      error: 'Please paste the API key manually in the account settings screen.',
    }
  }

  protected async processCallback(): Promise<void> {
    return
  }

  async validateToken(credentials: Record<string, string>): Promise<TokenValidationResult> {
    const token = credentials.token || credentials.apiKey || credentials.accessToken
    if (!token) {
      return { valid: false, error: 'API key cannot be empty' }
    }

    try {
      const isAnthropic = this.config.providerType === 'anthropic'
      const response = await axios.get(
        isAnthropic ? 'https://api.anthropic.com/v1/models' : 'https://api.openai.com/v1/models',
        {
          headers: isAnthropic
            ? {
                'x-api-key': token,
                'anthropic-version': '2023-06-01',
                Accept: 'application/json',
              }
            : {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
              },
          timeout: 15000,
          validateStatus: () => true,
        }
      )

      if (response.status >= 400) {
        return { valid: false, error: 'API key is invalid or expired' }
      }

      return {
        valid: true,
        tokenType: 'access',
        accountInfo: {
          name: isAnthropic ? 'Anthropic User' : 'OpenAI User',
        },
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      }
    }
  }

  async refreshToken(_credentials: Record<string, string>): Promise<string | null> {
    return null
  }
}

export default GenericTokenAdapter
