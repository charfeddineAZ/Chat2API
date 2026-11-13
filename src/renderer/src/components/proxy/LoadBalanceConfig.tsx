import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useProxyStore, type AccountWeight } from '@/stores/proxyStore'
import { useToast } from '@/hooks/use-toast'
import type { LoadBalanceStrategy, Account, Provider } from '@/types/electron'
import { Scale, RefreshCw, Info, ArrowUp, ArrowDown, Power } from 'lucide-react'

interface LoadBalanceConfigProps {
  onConfigChange?: () => void
}

const DEFAULT_SELECTION_CONFIG = {
  defaultWeight: 100,
  cooldownEnabled: true,
  cooldownMs: 30000,
  failoverThreshold: 3,
  recoveryMinutes: 1,
  skipDailyLimit: true,
  preferHealthyFirst: true,
}

export function LoadBalanceConfig({ onConfigChange }: LoadBalanceConfigProps) {
  const { t } = useTranslation()
  const {
    loadBalanceStrategy,
    setLoadBalanceStrategy,
    accountWeights,
    setAccountWeights,
    appConfig,
    saveAppConfig,
    isLoading,
  } = useProxyStore()
  const { toast } = useToast()

  const initialStrategyRef = useRef<LoadBalanceStrategy>(loadBalanceStrategy)
  const initialWeightsRef = useRef<AccountWeight[]>(accountWeights)
  const initialSelectionConfigRef = useRef(appConfig?.accountSelectionConfig ?? DEFAULT_SELECTION_CONFIG)

  const [selectedStrategy, setSelectedStrategy] = useState<LoadBalanceStrategy>(loadBalanceStrategy)
  const [weights, setWeights] = useState<AccountWeight[]>(accountWeights)
  const [selectionConfig, setSelectionConfig] = useState(appConfig?.accountSelectionConfig ?? DEFAULT_SELECTION_CONFIG)
  const [accounts, setAccounts] = useState<(Account & { provider?: Provider })[]>([])
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    fetchAccounts()
  }, [])

  useEffect(() => {
    const nextConfig = appConfig?.accountSelectionConfig ?? DEFAULT_SELECTION_CONFIG
    setSelectedStrategy(loadBalanceStrategy)
    setWeights(accountWeights)
    setSelectionConfig(nextConfig)
    initialStrategyRef.current = loadBalanceStrategy
    initialWeightsRef.current = accountWeights
    initialSelectionConfigRef.current = nextConfig
  }, [appConfig, loadBalanceStrategy, accountWeights])

  const fetchAccounts = async () => {
    try {
      const allAccounts = await window.electronAPI.accounts.getAll()
      const providers = await window.electronAPI.providers.getAll()

      const accountsWithProvider = allAccounts.map(account => ({
        ...account,
        provider: providers.find(p => p.id === account.providerId),
      }))

      setAccounts(accountsWithProvider)

      const defaultWeights = accountsWithProvider.map(account => ({
        accountId: account.id,
        weight: selectionConfig.defaultWeight || 100,
      }))

      const mergedWeights = defaultWeights.map(dw => {
        const existing = accountWeights.find(w => w.accountId === dw.accountId)
        return existing || dw
      })

      setWeights(mergedWeights)
    } catch (error) {
      console.error(t('proxy.failedToGetAccounts'), error)
    }
  }

  const updateSelectionConfig = <K extends keyof typeof DEFAULT_SELECTION_CONFIG>(key: K, value: (typeof DEFAULT_SELECTION_CONFIG)[K]) => {
    setSelectionConfig(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
    onConfigChange?.()
  }

  const handleStrategyChange = (value: LoadBalanceStrategy) => {
    setSelectedStrategy(value)
    setHasChanges(true)
    onConfigChange?.()
  }

  const handleWeightChange = (accountId: string, weight: number) => {
    setWeights(prev => prev.map(w =>
      w.accountId === accountId ? { ...w, weight } : w
    ))
    setHasChanges(true)
    onConfigChange?.()
  }

  const handleSave = async () => {
    setLoadBalanceStrategy(selectedStrategy)
    setAccountWeights(weights)

    const success = await saveAppConfig({
      loadBalanceStrategy: selectedStrategy,
      accountWeights: weights,
      accountSelectionConfig: selectionConfig,
    })

    if (success) {
      setHasChanges(false)
      toast({
        title: t('common.success'),
        description: t('proxy.loadBalanceConfig'),
      })
    } else {
      toast({
        title: t('common.error'),
        description: t('proxy.configSaveFailed'),
        variant: 'destructive',
      })
    }
  }

  const handleReset = () => {
    setSelectedStrategy(initialStrategyRef.current)
    setWeights(initialWeightsRef.current)
    setSelectionConfig(initialSelectionConfigRef.current)
    setHasChanges(false)
  }

  const activeAccounts = accounts
    .filter(a => a.status === 'active')
    .sort((a, b) => (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0))

  const moveAccountInRotation = async (accountId: string, direction: 'up' | 'down') => {
    const ordered = [...activeAccounts].sort((a, b) => (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0))
    const index = ordered.findIndex(account => account.id === accountId)
    if (index === -1) return

    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= ordered.length) return

    const reordered = [...ordered]
    const [entry] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, entry)

    const updates = reordered.map((account, position) => ({
      id: account.id,
      rotationOrder: position + 1,
    }))

    await Promise.all(
      updates.map(async ({ id, rotationOrder }) => {
        await window.electronAPI.accounts.update(id, { rotationOrder })
      })
    )

    await fetchAccounts()
  }

  const toggleAccountStatus = async (accountId: string, nextStatus: 'active' | 'inactive') => {
    await window.electronAPI.accounts.update(accountId, { status: nextStatus })
    await fetchAccounts()
  }

  const getStrategyLabel = (strategy: LoadBalanceStrategy): string => {
    const labels: Record<LoadBalanceStrategy, string> = {
      'round-robin': t('proxy.roundRobin'),
      'fill-first': t('proxy.fillFirst'),
      'failover': t('proxy.failover'),
    }
    return labels[strategy]
  }

  const getStrategyDescription = (strategy: LoadBalanceStrategy): string => {
    const descriptions: Record<LoadBalanceStrategy, string> = {
      'round-robin': t('proxy.roundRobinDesc'),
      'fill-first': t('proxy.fillFirstDesc'),
      'failover': t('proxy.failoverDesc'),
    }
    return descriptions[strategy]
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <CardTitle>{t('proxy.accountRotation')}</CardTitle>
          </div>
          {hasChanges && (
            <Badge variant="secondary" className="text-xs">
              {t('proxy.unsaved')}
            </Badge>
          )}
        </div>
        <CardDescription>{t('proxy.accountRotationDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="strategy">{t('proxy.loadBalanceStrategy')}</Label>
          <Select value={selectedStrategy} onValueChange={handleStrategyChange}>
            <SelectTrigger id="strategy">
              <SelectValue placeholder={t('proxy.selectStrategy')} />
            </SelectTrigger>
            <SelectContent>
              {(['round-robin', 'fill-first', 'failover'] as LoadBalanceStrategy[]).map((strategy) => (
                <SelectItem key={strategy} value={strategy}>
                  {getStrategyLabel(strategy)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              {getStrategyDescription(selectedStrategy)}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 border rounded-xl p-4">
          <div className="space-y-2">
            <Label htmlFor="defaultWeight">{t('proxy.defaultWeight')}</Label>
            <input
              id="defaultWeight"
              type="number"
              min={1}
              max={1000}
              value={selectionConfig.defaultWeight}
              onChange={(e) => updateSelectionConfig('defaultWeight', Number(e.target.value) || 1)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cooldownMs">{t('proxy.cooldownMs')}</Label>
            <input
              id="cooldownMs"
              type="number"
              min={0}
              step={1000}
              value={selectionConfig.cooldownMs}
              onChange={(e) => updateSelectionConfig('cooldownMs', Number(e.target.value) || 0)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="failoverThreshold">{t('proxy.failoverThreshold')}</Label>
            <input
              id="failoverThreshold"
              type="number"
              min={1}
              max={20}
              value={selectionConfig.failoverThreshold}
              onChange={(e) => updateSelectionConfig('failoverThreshold', Number(e.target.value) || 1)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recoveryMinutes">{t('proxy.recoveryMinutes')}</Label>
            <input
              id="recoveryMinutes"
              type="number"
              min={1}
              max={120}
              value={selectionConfig.recoveryMinutes}
              onChange={(e) => updateSelectionConfig('recoveryMinutes', Number(e.target.value) || 1)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="space-y-4 border rounded-xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>{t('proxy.cooldownEnabled')}</Label>
              <p className="text-xs text-muted-foreground">{t('proxy.cooldownEnabledDesc')}</p>
            </div>
            <Switch checked={selectionConfig.cooldownEnabled} onCheckedChange={(checked) => updateSelectionConfig('cooldownEnabled', checked)} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>{t('proxy.skipDailyLimit')}</Label>
              <p className="text-xs text-muted-foreground">{t('proxy.skipDailyLimitDesc')}</p>
            </div>
            <Switch checked={selectionConfig.skipDailyLimit} onCheckedChange={(checked) => updateSelectionConfig('skipDailyLimit', checked)} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>{t('proxy.preferHealthyFirst')}</Label>
              <p className="text-xs text-muted-foreground">{t('proxy.preferHealthyFirstDesc')}</p>
            </div>
            <Switch checked={selectionConfig.preferHealthyFirst} onCheckedChange={(checked) => updateSelectionConfig('preferHealthyFirst', checked)} />
          </div>
        </div>

        {activeAccounts.length > 0 && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <Label>{t('proxy.accountWeightConfig')}</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchAccounts}
                className="h-8 px-2"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                {t('common.refresh')}
              </Button>
            </div>

            <div className="space-y-4">
              {activeAccounts.map(account => {
                const weight = weights.find(w => w.accountId === account.id)?.weight || selectionConfig.defaultWeight || 100
                return (
                  <div key={account.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{account.name}</span>
                        {account.provider && (
                          <Badge variant="outline" className="text-xs">
                            {account.provider.name}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => moveAccountInRotation(account.id, 'up')}
                          disabled={activeAccounts.findIndex(item => item.id === account.id) === 0}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => moveAccountInRotation(account.id, 'down')}
                          disabled={activeAccounts.findIndex(item => item.id === account.id) === activeAccounts.length - 1}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={account.status === 'active' ? 'secondary' : 'outline'}
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => toggleAccountStatus(account.id, account.status === 'active' ? 'inactive' : 'active')}
                        >
                          <Power className="h-3.5 w-3.5 mr-1" />
                          {account.status === 'active' ? t('common.disable') || 'Disable' : t('common.enable') || 'Enable'}
                        </Button>
                        <span className="text-sm text-muted-foreground w-12 text-right">
                          {weight}%
                        </span>
                      </div>
                    </div>
                    <Slider
                      value={[weight]}
                      onValueChange={([value]) => handleWeightChange(account.id, value)}
                      max={100}
                      step={5}
                      className="w-full"
                    />
                  </div>
                )
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              {t('proxy.weightHelp')}
            </p>
          </div>
        )}

        {activeAccounts.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">{t('proxy.noActiveAccounts')}</p>
            <p className="text-xs mt-1">{t('proxy.addAndActivateAccount')}</p>
          </div>
        )}

        <div className="flex justify-end space-x-2 pt-4">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!hasChanges || isLoading}
          >
            {t('common.reset')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isLoading}
          >
            {isLoading ? t('proxy.saving') : t('proxy.saveConfig')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default LoadBalanceConfig
