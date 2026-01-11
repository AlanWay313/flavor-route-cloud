import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

interface UseRealtimeHealthMonitorOptions {
  companyId: string | null;
  onReconnect?: () => void;
  pollingIntervalMs?: number;
  maxReconnectAttempts?: number;
}

/**
 * Hook de monitoramento de saúde da conexão realtime
 * Implementa:
 * - Detecção de desconexão
 * - Reconexão automática
 * - Polling de fallback quando realtime falha
 * - Alertas visuais para o lojista
 */
export function useRealtimeHealthMonitor({
  companyId,
  onReconnect,
  pollingIntervalMs = 30000, // 30 segundos
  maxReconnectAttempts = 5,
}: UseRealtimeHealthMonitorOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connected');
  const [lastHeartbeat, setLastHeartbeat] = useState<Date>(new Date());
  const [isPollingActive, setIsPollingActive] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Limpar todos os timeouts/intervals
  const cleanupTimers = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Iniciar polling de fallback
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current || !companyId) return;
    
    console.log('[RealtimeHealth] Iniciando polling de fallback');
    setIsPollingActive(true);
    
    pollingIntervalRef.current = setInterval(() => {
      console.log('[RealtimeHealth] Polling executado');
      onReconnect?.();
    }, pollingIntervalMs);
  }, [companyId, pollingIntervalMs, onReconnect]);

  // Parar polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      console.log('[RealtimeHealth] Parando polling de fallback');
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setIsPollingActive(false);
    }
  }, []);

  // Tentar reconectar
  const attemptReconnect = useCallback(() => {
    if (!companyId) return;
    
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.log('[RealtimeHealth] Máximo de tentativas de reconexão atingido, mantendo polling');
      setConnectionStatus('disconnected');
      startPolling();
      return;
    }

    setConnectionStatus('reconnecting');
    setReconnectAttempts(prev => prev + 1);
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 16000);
    
    console.log(`[RealtimeHealth] Tentando reconectar em ${delay}ms (tentativa ${reconnectAttempts + 1})`);
    
    reconnectTimeoutRef.current = setTimeout(() => {
      // Remove o canal antigo
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      
      // Cria novo canal de monitoramento
      setupHealthChannel();
    }, delay);
  }, [companyId, reconnectAttempts, maxReconnectAttempts, startPolling]);

  // Configurar canal de saúde
  const setupHealthChannel = useCallback(() => {
    if (!companyId) return;

    console.log('[RealtimeHealth] Configurando canal de monitoramento');

    const channel = supabase
      .channel(`health-monitor-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          // Qualquer evento indica que a conexão está funcionando
          setLastHeartbeat(new Date());
          
          if (connectionStatus !== 'connected') {
            console.log('[RealtimeHealth] Conexão restaurada via evento');
            setConnectionStatus('connected');
            setReconnectAttempts(0);
            stopPolling();
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[RealtimeHealth] Status do canal:', status, err);
        
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          setReconnectAttempts(0);
          setLastHeartbeat(new Date());
          stopPolling();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[RealtimeHealth] Erro no canal:', err);
          setConnectionStatus('reconnecting');
          startPolling(); // Inicia polling imediatamente
          attemptReconnect();
        } else if (status === 'CLOSED') {
          console.log('[RealtimeHealth] Canal fechado');
          setConnectionStatus('disconnected');
          startPolling();
        }
      });

    channelRef.current = channel;

    // Heartbeat timeout - se não receber eventos em 2 minutos, considera desconectado
    // (não ativa em produção pois pode não haver pedidos)
    // heartbeatTimeoutRef.current = setTimeout(() => {
    //   console.log('[RealtimeHealth] Heartbeat timeout');
    //   attemptReconnect();
    // }, 120000);

  }, [companyId, connectionStatus, stopPolling, startPolling, attemptReconnect]);

  // Efeito principal
  useEffect(() => {
    if (!companyId) {
      setConnectionStatus('connected'); // Não monitorar se não há empresa
      return;
    }

    setupHealthChannel();

    return () => {
      cleanupTimers();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [companyId, setupHealthChannel, cleanupTimers]);

  // Forçar reconexão manual
  const forceReconnect = useCallback(() => {
    console.log('[RealtimeHealth] Reconexão forçada pelo usuário');
    setReconnectAttempts(0);
    cleanupTimers();
    
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    
    setupHealthChannel();
    onReconnect?.();
  }, [cleanupTimers, setupHealthChannel, onReconnect]);

  return {
    connectionStatus,
    isPollingActive,
    lastHeartbeat,
    reconnectAttempts,
    forceReconnect,
  };
}
