/**
 * Proxy Service Module - Load Balancer
 * Implements Round Robin and Fill First strategies
 */

import { Account, Provider, LoadBalanceStrategy, DEFAULT_CONFIG } from '../store/types'
import { AccountSelection } from './types'
import { storeManager } from '../store/store'

/**
 * Load Balancer
 */
export class LoadBalancer {
  private roundRobinIndex: Map<string, number> = new Map()
  private failedAccounts: Map<string, { count: number; lastFailTime: number }> = new Map()
  private static readonly DEFAULT_FAIL_THRESHOLD = 3
  private static readonly DEFAULT_RECOVERY_TIME = 60000 // 1 minute

  private getFailThreshold(): number {
    const config = storeManager.getConfig()
    return Math.max(1, config.accountSelectionConfig?.failoverThreshold ?? LoadBalancer.DEFAULT_FAIL_THRESHOLD)
  }

  private getRecoveryTimeMs(): number {
    const config = storeManager.getConfig()
    const minutes = config.accountSelectionConfig?.recoveryMinutes ?? 1
    return Math.max(30000, minutes * 60 * 1000)
  }

  /**
   * Mark account as failed
   */
  markAccountFailed(accountId: string): void {
    const current = this.failedAccounts.get(accountId) || { count: 0, lastFailTime: 0 }
    this.failedAccounts.set(accountId, {
      count: current.count + 1,
      lastFailTime: Date.now(),
    })
  }

  /**
   * Clear account failure status
   */
  clearAccountFailure(accountId: string): void {
    this.failedAccounts.delete(accountId)
  }

  /**
   * Check if account is in failure state
   */
  private isAccountInFailure(accountId: string): boolean {
    const failure = this.failedAccounts.get(accountId)
    if (!failure) return false

    if (Date.now() - failure.lastFailTime > this.getRecoveryTimeMs()) {
      this.failedAccounts.delete(accountId)
      return false
    }

    return failure.count >= this.getFailThreshold()
  }

  /**
   * Select account
   * @param model Requested model
   * @param strategy Load balance strategy
   * @param preferredProviderId Preferred provider ID
   * @param preferredAccountId Preferred account ID
   */
  selectAccount(
    model: string,
    strategy: LoadBalanceStrategy = 'round-robin',
    preferredProviderId?: string,
    preferredAccountId?: string
  ): AccountSelection | null {
    const candidates = this.getAvailableAccounts(model, preferredProviderId, strategy === 'failover')

    if (candidates.length === 0) {
      return null
    }

    if (preferredAccountId) {
      const preferred = candidates.find(c => c.account.id === preferredAccountId)
      if (preferred && !this.isAccountInFailure(preferredAccountId)) {
        return preferred
      }
    }

    if (strategy === 'weighted-round-robin') {
      return this.selectWeightedRoundRobin(candidates)
    }

    if (strategy === 'fill-first') {
      return this.selectFillFirst(candidates)
    }

    if (strategy === 'least-latency') {
      return this.selectLeastLatency(candidates)
    }

    if (strategy === 'least-used') {
      return this.selectLeastUsed(candidates)
    }

    if (strategy === 'failover') {
      return this.selectFailover(candidates)
    }

    return this.selectRoundRobin(candidates)
  }

  /**
   * Get available accounts list
   */
  private getAvailableAccounts(
    model: string,
    preferredProviderId?: string,
    excludeFailed: boolean = false
  ): AccountSelection[] {
    const providers = storeManager.getProviders().filter(p => p.enabled)
    const candidates: AccountSelection[] = []

    for (const provider of providers) {
      if (preferredProviderId && provider.id !== preferredProviderId) {
        continue
      }

      if (!this.providerSupportsModel(provider, model)) {
        continue
      }

      const accounts = storeManager.getAccountsByProviderId(provider.id, true)
        .filter(account => this.isAccountAvailable(account))
        .filter(account => !excludeFailed || !this.isAccountInFailure(account.id))
        .sort((a, b) => (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0))

      console.log(`[LoadBalancer] Provider ${provider.name} (${provider.id}) has ${accounts.length} available accounts`)

      for (const account of accounts) {
        console.log(`[LoadBalancer] Account ${account.name} (${account.id}) Token: ${(account.credentials.token || '').substring(0, 20)}...`)
        candidates.push({
          account,
          provider,
          actualModel: this.mapModel(model, provider),
        })
      }
    }

    return candidates
  }

  /**
   * Check if provider supports model
   */
  private providerSupportsModel(provider: Provider, model: string): boolean {
    const effectiveModels = storeManager.getEffectiveModels(provider.id)
    if (effectiveModels.length === 0) {
      return true
    }

    const normalizedModel = model.toLowerCase()
    const supported = effectiveModels.some(m => {
      const normalizedSupported = m.displayName.toLowerCase()
      if (normalizedSupported.endsWith('*')) {
        return normalizedModel.startsWith(normalizedSupported.slice(0, -1))
      }
      return normalizedSupported === normalizedModel
    })
    
    if (supported) {
      return true
    }

    const config = storeManager.getConfig()
    const globalMapping = config.modelMappings[model]
    if (globalMapping) {
      if (globalMapping.preferredProviderId) {
        if (globalMapping.preferredProviderId === provider.id) {
          console.log(`[LoadBalancer] Model "${model}" matched preferred provider ${provider.name}`)
          return true
        }
        return false
      }
      
      const actualModel = globalMapping.actualModel
      const normalizedActualModel = actualModel.toLowerCase()
      const actualSupported = effectiveModels.some(m => {
        const normalizedSupported = m.displayName.toLowerCase()
        if (normalizedSupported.endsWith('*')) {
          return normalizedActualModel.startsWith(normalizedSupported.slice(0, -1))
        }
        return normalizedSupported === normalizedActualModel
      })
      
      if (actualSupported) {
        console.log(`[LoadBalancer] Model "${model}" (actualModel: "${actualModel}") supported by ${provider.name}`)
        return true
      }
    }
    
    console.log(`[LoadBalancer] Provider ${provider.name} does not support model ${model}`)
    return false
  }

  /**
   * Check if account is available
   */
  private isAccountAvailable(account: Account): boolean {
    if (account.status !== 'active') {
      return false
    }

    const config = storeManager.getConfig()
    const selectionConfig = config.accountSelectionConfig || DEFAULT_CONFIG.accountSelectionConfig

    if (selectionConfig.cooldownEnabled && account.lastUsed) {
      const cooldownMs = Math.max(0, selectionConfig.cooldownMs || 30000)
      if (Date.now() - account.lastUsed < cooldownMs) {
        return false
      }
    }

    if (selectionConfig.skipDailyLimit && account.dailyLimit && (account.todayUsed || 0) >= account.dailyLimit) {
      return false
    }

    return true
  }

  /**
   * Map model name
   */
  private mapModel(model: string, provider: Provider): string {
    console.log(`[LoadBalancer] mapModel called with model="${model}", provider="${provider.name}"`)
    
    const effectiveModels = storeManager.getEffectiveModels(provider.id)
    const effectiveModel = effectiveModels.find(m => 
      m.displayName.toLowerCase() === model.toLowerCase()
    )
    
    if (effectiveModel) {
      console.log(`[LoadBalancer] Model mapped from "${model}" to "${effectiveModel.actualModelId}" via effective models`)
      return effectiveModel.actualModelId
    }

    const config = storeManager.getConfig()
    const mapping = config.modelMappings[model]

    if (mapping && (!mapping.preferredProviderId || mapping.preferredProviderId === provider.id)) {
      const actualModel = mapping.actualModel
      console.log(`[LoadBalancer] Model mapped from "${model}" to "${actualModel}" via global mapping`)
      
      const actualEffectiveModel = effectiveModels.find(m => 
        m.displayName.toLowerCase() === actualModel.toLowerCase()
      )
      if (actualEffectiveModel) {
        console.log(`[LoadBalancer] Model further mapped from "${actualModel}" to "${actualEffectiveModel.actualModelId}" via effective models`)
        return actualEffectiveModel.actualModelId
      }
      
      return actualModel
    }

    console.log(`[LoadBalancer] No mapping found, returning original model "${model}"`)
    return model
  }

  /**
   * Round Robin strategy with weighted selection support.
   * Higher weight accounts are chosen more often while preserving sequence ordering.
   */
  private selectRoundRobin(candidates: AccountSelection[]): AccountSelection {
    const providerIds = [...new Set(candidates.map(c => c.provider.id))]
    const key = providerIds.join(',')

    const currentIndex = this.roundRobinIndex.get(key) || 0
    const weights = candidates.map((candidate) => this.getAccountWeight(candidate.account.id))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

    if (totalWeight <= 0 || candidates.length === 0) {
      const selected = candidates[currentIndex % candidates.length]
      this.roundRobinIndex.set(key, (currentIndex + 1) % Math.max(candidates.length, 1))
      return selected
    }

    let target = currentIndex % totalWeight
    let selected = candidates[0]

    for (let i = 0; i < candidates.length; i++) {
      const weight = weights[i]
      if (target < weight) {
        selected = candidates[i]
        break
      }
      target -= weight
    }

    this.roundRobinIndex.set(key, (currentIndex + 1) % totalWeight)
    return selected
  }

  /**
   * Returns the configured weight for an account, defaulting to 100 when unset.
   */
  private getAccountWeight(accountId: string): number {
    const config = storeManager.getConfig()
    const defaultWeight = Number(config.accountSelectionConfig?.defaultWeight ?? DEFAULT_CONFIG.accountSelectionConfig.defaultWeight)
    const entry = config.accountWeights?.find(weight => weight.accountId === accountId)
    const weight = Number(entry?.weight ?? defaultWeight)
    if (!Number.isFinite(weight) || weight <= 0) {
      return defaultWeight > 0 ? defaultWeight : 100
    }
    return weight
  }

  private selectWeightedRoundRobin(candidates: AccountSelection[]): AccountSelection {
    const totalWeight = candidates.reduce((sum, candidate) => sum + this.getAccountWeight(candidate.account.id), 0)
    if (totalWeight <= 0) return this.selectRoundRobin(candidates)

    const providerIds = [...new Set(candidates.map(c => c.provider.id))]
    const key = `${providerIds.join(',')}:weighted`
    const currentIndex = this.roundRobinIndex.get(key) || 0
    let target = currentIndex % totalWeight

    for (const candidate of candidates) {
      const weight = this.getAccountWeight(candidate.account.id)
      if (target < weight) {
        this.roundRobinIndex.set(key, (currentIndex + 1) % totalWeight)
        return candidate
      }
      target -= weight
    }

    const fallback = candidates[currentIndex % candidates.length]
    this.roundRobinIndex.set(key, (currentIndex + 1) % totalWeight)
    return fallback
  }

  /**
   * Fill First strategy
   * Use current account preferentially until limit is reached
   */
  private selectFillFirst(candidates: AccountSelection[]): AccountSelection {
    return candidates.reduce((best, current) => {
      const bestUsed = best.account.todayUsed || 0
      const currentUsed = current.account.todayUsed || 0

      if (currentUsed < bestUsed) {
        return current
      }

      if (currentUsed === bestUsed) {
        const bestLastUsed = best.account.lastUsed || 0
        const currentLastUsed = current.account.lastUsed || 0

        if (currentLastUsed < bestLastUsed) {
          return current
        }
      }

      return best
    })
  }

  private selectLeastLatency(candidates: AccountSelection[]): AccountSelection {
    return candidates.reduce((best, current) => {
      const bestLatency = best.account.lastLatencyMs ?? Number.MAX_SAFE_INTEGER
      const currentLatency = current.account.lastLatencyMs ?? Number.MAX_SAFE_INTEGER
      if (currentLatency < bestLatency) return current
      if (currentLatency === bestLatency && (current.account.lastUsed ?? 0) < (best.account.lastUsed ?? 0)) return current
      return best
    })
  }

  private selectLeastUsed(candidates: AccountSelection[]): AccountSelection {
    return candidates.reduce((best, current) => {
      const bestUsed = best.account.todayUsed || 0
      const currentUsed = current.account.todayUsed || 0
      if (currentUsed < bestUsed) return current
      if (currentUsed === bestUsed && (current.account.lastUsed ?? 0) < (best.account.lastUsed ?? 0)) return current
      return best
    })
  }

  /**
   * Failover strategy
   * Select account with least failures, preferring healthy accounts
   */
  private selectFailover(candidates: AccountSelection[]): AccountSelection {
    const healthyCandidates = candidates.filter(c => !this.isAccountInFailure(c.account.id))
    
    if (healthyCandidates.length > 0) {
      return this.selectWeightedRoundRobin(healthyCandidates)
    }

    const sortedCandidates = candidates.sort((a, b) => {
      const failureA = this.failedAccounts.get(a.account.id)
      const failureB = this.failedAccounts.get(b.account.id)

      const countA = failureA ? failureA.count : 0
      const countB = failureB ? failureB.count : 0

      if (countA !== countB) {
        return countA - countB
      }

      const timeA = failureA ? failureA.lastFailTime : 0
      const timeB = failureB ? failureB.lastFailTime : 0

      return timeA - timeB
    })

    return sortedCandidates[0]
  }

  /**
   * Reset Round Robin index
   */
  resetRoundRobinIndex(): void {
    this.roundRobinIndex.clear()
  }

  /**
   * Get available account count
   */
  getAvailableAccountCount(model: string, providerId?: string): number {
    return this.getAvailableAccounts(model, providerId).length
  }

  /**
   * Get all available models
   */
  getAvailableModels(): string[] {
    const providers = storeManager.getProviders().filter(p => p.enabled)
    const models = new Set<string>()

    for (const provider of providers) {
      const accounts = storeManager.getAccountsByProviderId(provider.id)
        .filter(account => this.isAccountAvailable(account))

      if (accounts.length > 0) {
        const effectiveModels = storeManager.getEffectiveModels(provider.id)
        effectiveModels.forEach(m => models.add(m.displayName))
      }
    }

    return [...models]
  }
}

export const loadBalancer = new LoadBalancer()
export default loadBalancer
