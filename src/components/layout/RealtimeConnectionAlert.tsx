import { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ConnectionStatus } from '@/hooks/useRealtimeHealthMonitor';

interface RealtimeConnectionAlertProps {
  connectionStatus: ConnectionStatus;
  isPollingActive: boolean;
  reconnectAttempts: number;
  onForceReconnect: () => void;
}

/**
 * Componente de alerta visual para status da conexão realtime
 * Mostra quando a conexão cai e informa que o polling está ativo como backup
 */
export function RealtimeConnectionAlert({
  connectionStatus,
  isPollingActive,
  reconnectAttempts,
  onForceReconnect,
}: RealtimeConnectionAlertProps) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed quando status muda
  useEffect(() => {
    if (connectionStatus === 'connected') {
      setDismissed(false);
    }
  }, [connectionStatus]);

  // Não mostrar se conectado ou dispensado
  if (connectionStatus === 'connected' || dismissed) {
    return null;
  }

  const isReconnecting = connectionStatus === 'reconnecting';
  const isDisconnected = connectionStatus === 'disconnected';

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border p-4 shadow-lg',
        'animate-in slide-in-from-bottom-4 duration-300',
        isReconnecting && 'border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/30',
        isDisconnected && 'border-red-500/50 bg-red-50 dark:bg-red-950/30'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 rounded-full p-2',
            isReconnecting && 'bg-yellow-100 dark:bg-yellow-900/50',
            isDisconnected && 'bg-red-100 dark:bg-red-900/50'
          )}
        >
          {isReconnecting ? (
            <WifiOff className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          ) : (
            <WifiOff className="h-4 w-4 text-red-600 dark:text-red-400" />
          )}
        </div>

        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <h4
              className={cn(
                'text-sm font-semibold',
                isReconnecting && 'text-yellow-800 dark:text-yellow-200',
                isDisconnected && 'text-red-800 dark:text-red-200'
              )}
            >
              {isReconnecting ? 'Reconectando...' : 'Conexão Perdida'}
            </h4>
            <button
              onClick={() => setDismissed(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p
            className={cn(
              'text-xs',
              isReconnecting && 'text-yellow-700 dark:text-yellow-300',
              isDisconnected && 'text-red-700 dark:text-red-300'
            )}
          >
            {isReconnecting
              ? `Tentando reconectar (tentativa ${reconnectAttempts})...`
              : 'Não foi possível reconectar ao servidor.'}
          </p>

          {isPollingActive && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wifi className="h-3 w-3" />
              <span>Modo backup ativo - atualizando a cada 30s</span>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={isDisconnected ? 'default' : 'outline'}
              onClick={onForceReconnect}
              className="h-7 text-xs"
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              Reconectar Agora
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
