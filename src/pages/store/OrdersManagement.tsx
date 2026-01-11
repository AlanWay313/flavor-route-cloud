import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Clock,
  Package,
  CheckCircle,
  ChefHat,
  Truck,
  XCircle,
  Loader2,
  Phone,
  MapPin,
  RefreshCw,
  Bell,
  UserPlus,
  Users,
  AlertTriangle,
  AlertCircle,
  Send,
  Lock,
  PlusCircle,
  FileText,
  CreditCard,
  Banknote,
  Smartphone,
  Wallet,
  Store,
  UtensilsCrossed,
  ListOrdered,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { RealtimeConnectionAlert } from '@/components/layout/RealtimeConnectionAlert';
import { useRealtimeHealthMonitor } from '@/hooks/useRealtimeHealthMonitor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useActivityLog } from '@/hooks/useActivityLog';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { notifyOrderStatusChange, notifyDriverNewOrder } from '@/hooks/useOrderNotifications';
import { supabase } from '@/integrations/supabase/client';
import { SubscriptionAlert } from '@/components/SubscriptionAlert';
import { PrintReceipt } from '@/components/orders/PrintReceipt';
import { CancelOrderDialog } from '@/components/orders/CancelOrderDialog';
import { Database } from '@/integrations/supabase/types';
import { formatDistanceToNow, startOfDay, startOfWeek, startOfMonth, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type PeriodFilter = 'today' | 'week' | 'month' | 'all';

type OrderStatus = Database['public']['Enums']['order_status'];
type PaymentMethod = Database['public']['Enums']['payment_method'];
type PaymentStatus = Database['public']['Enums']['payment_status'];

interface OrderItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  options: unknown;
  notes: string | null;
  requires_preparation?: boolean;
}

interface DeliveryAddress {
  id: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  reference: string | null;
}

interface DeliveryDriver {
  id: string;
  driver_name: string | null;
  driver_phone: string | null;
  is_available: boolean;
  driver_status: string | null;
}

interface Coupon {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
}

interface ReferralCode {
  id: string;
  code: string;
  customers?: {
    name: string;
  };
}

interface Order {
  id: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_id: string | null;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal: number;
  delivery_fee: number;
  discount_amount: number | null;
  total: number;
  notes: string | null;
  delivery_driver_id: string | null;
  delivery_address_id: string | null;
  coupon_id: string | null;
  referral_code_id: string | null;
  needs_change?: boolean;
  change_for?: number | null;
  cancellation_reason?: string | null;
  source?: string;
  order_items?: OrderItem[];
  customer_addresses?: DeliveryAddress;
  delivery_driver?: DeliveryDriver;
  coupons?: Coupon;
  customer_referral_codes?: ReferralCode;
}

const statusConfig: Record<OrderStatus, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: 'Pendente', icon: Clock, color: 'bg-yellow-500' },
  confirmed: { label: 'Confirmado', icon: CheckCircle, color: 'bg-blue-500' },
  preparing: { label: 'Preparando', icon: ChefHat, color: 'bg-orange-500' },
  ready: { label: 'Pronto', icon: Package, color: 'bg-purple-500' },
  awaiting_driver: { label: 'Aguardando Entregador', icon: Truck, color: 'bg-amber-500' },
  queued: { label: 'Na Fila', icon: ListOrdered, color: 'bg-indigo-500' },
  out_for_delivery: { label: 'A caminho', icon: Truck, color: 'bg-cyan-500' },
  delivered: { label: 'Entregue', icon: CheckCircle, color: 'bg-green-500' },
  cancelled: { label: 'Cancelado', icon: XCircle, color: 'bg-red-500' },
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  pix: 'PIX',
  cash: 'Dinheiro',
  card_on_delivery: 'Cartão na entrega',
  online: 'Cartão online',
  pay_at_counter: 'Pagar no balcão',
};

const statusMessages: Record<OrderStatus, string> = {
  pending: 'Seu pedido foi recebido e está aguardando confirmação.',
  confirmed: 'Seu pedido foi confirmado! Em breve começaremos a preparar.',
  preparing: 'Seu pedido está sendo preparado com carinho! 👨‍🍳',
  ready: 'Seu pedido está pronto! Aguardando entregador.',
  awaiting_driver: 'Seu pedido está pronto! Estamos aguardando um entregador.',
  queued: 'Seu pedido está na fila do entregador e será entregue assim que possível.',
  out_for_delivery: 'Seu pedido saiu para entrega! 🛵 Em breve chegará até você.',
  delivered: 'Pedido entregue! Obrigado pela preferência! 😊',
  cancelled: 'Seu pedido foi cancelado.',
};

const statusFlow: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'awaiting_driver', 'out_for_delivery', 'delivered'];

// Fluxo simplificado para pedidos de mesa: Pendente → Confirmado → Preparando → Pronto → Servido
const tableStatusFlow: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'delivered'];

// Fluxo simplificado para retirada no balcão: Pendente → Confirmado → Preparando → Pronto → Retirado
const pickupStatusFlow: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'delivered'];

// Labels específicos para cada tipo de pedido
const getStatusLabel = (status: OrderStatus, source?: string): string => {
  if (status === 'delivered') {
    if (source === 'table') return 'Servido';
    if (source === 'pickup') return 'Retirado';
  }
  return statusConfig[status].label;
};

interface NotificationSoundSetting {
  event_type: 'status_change';
  sound_key: string;
  enabled: boolean;
  volume: number | null;
}

export default function OrdersManagement() {
  const navigate = useNavigate();
  const { user, staffCompany } = useAuth();
  const { toast } = useToast();
  const { logActivity } = useActivityLog();
  const { status: subscriptionStatus } = useSubscriptionStatus();

  const { playSound: playNewOrderSound } = useNotificationSound('new_order', {
    defaultVolume: 0.6,
  });
  const { playSound: playStatusChangeSound } = useNotificationSound('status_change', {
    defaultVolume: 0.6,
  });

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('Loja');
  const [companySlug, setCompanySlug] = useState<string>('');
  const [companyStatus, setCompanyStatus] = useState<string>('pending');
  const [autoPrintKitchen, setAutoPrintKitchen] = useState<boolean>(false);
  const [autoPrintMode, setAutoPrintMode] = useState<'kitchen' | 'full' | 'both'>('kitchen');
  const [autoPrintTrigger, setAutoPrintTrigger] = useState<number>(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('today');
  const [availableDrivers, setAvailableDrivers] = useState<DeliveryDriver[]>([]);
  const [assigningDriver, setAssigningDriver] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [nfeEnabled, setNfeEnabled] = useState(false);
  const [showWhatsappDialog, setShowWhatsappDialog] = useState(false);
  const [whatsappOrder, setWhatsappOrder] = useState<{ order: Order; newStatus: OrderStatus } | null>(null);
  const [whatsappNotificationsEnabled, setWhatsappNotificationsEnabled] = useState(true);
  const [companyCnpj, setCompanyCnpj] = useState<string | null>(null);
  const [issuingNfe, setIssuingNfe] = useState(false);
  const [orderNfeStatus, setOrderNfeStatus] = useState<Record<string, string>>({});
  const [showConvertToDeliveryDialog, setShowConvertToDeliveryDialog] = useState(false);
  const [convertingToDelivery, setConvertingToDelivery] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState({
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    zip_code: '',
    reference: '',
  });

  // Função de reload para o fallback de polling
  const reloadOrders = useCallback(async () => {
    if (!companyId) return;
    
    console.log('[OrdersManagement] Polling fallback - recarregando pedidos');
    try {
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (*),
          customer_addresses:delivery_address_id (*),
          coupons:coupon_id (id, code, discount_type, discount_value),
          customer_referral_codes:referral_code_id (id, code, customers:customer_id (name))
        `)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (!ordersError && ordersData) {
        setOrders(ordersData);
      }
    } catch (error) {
      console.error('[OrdersManagement] Erro no polling:', error);
    }
  }, [companyId]);

  // Hook de monitoramento de saúde da conexão realtime
  const {
    connectionStatus,
    isPollingActive,
    reconnectAttempts,
    forceReconnect,
  } = useRealtimeHealthMonitor({
    companyId,
    onReconnect: reloadOrders,
    pollingIntervalMs: 30000, // 30 segundos
  });

  useEffect(() => {
    loadCompanyAndOrders();
  }, [user]);

  // Load available drivers when company is set
  useEffect(() => {
    if (companyId) {
      loadAvailableDrivers();
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;

    // Subscribe to realtime updates
    const channel = supabase
      .channel('orders-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          console.log('Order change:', payload);
          if (payload.eventType === 'INSERT') {
            // Pequeno delay para garantir que os itens já foram gravados antes de buscar os detalhes
            setTimeout(() => {
              loadOrderDetails(payload.new.id);
            }, 500);

            toast({
              title: 'Novo pedido!',
              description: `Pedido #${payload.new.id.slice(0, 8)} recebido`,
            });

            // Som configurado para novo pedido
            playNewOrderSound();
          } else if (payload.eventType === 'UPDATE') {
            setOrders((prev) =>
              prev.map((o) => (o.id === payload.new.id ? { ...o, ...payload.new } : o))
            );

            // Som configurado para mudança de status
            if (payload.new.status !== payload.old?.status) {
              playStatusChangeSound();
            }
          } else if (payload.eventType === 'DELETE') {
            setOrders((prev) => prev.filter((o) => o.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, toast, playNewOrderSound, playStatusChangeSound]);

  const loadCompanyAndOrders = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const companyQuery = staffCompany?.companyId
        ? supabase.from('companies').select('id, name, slug, auto_print_kitchen, auto_print_mode, status, cnpj, whatsapp_notifications_enabled').eq('id', staffCompany.companyId).maybeSingle()
        : supabase.from('companies').select('id, name, slug, auto_print_kitchen, auto_print_mode, status, cnpj, whatsapp_notifications_enabled').eq('owner_id', user.id).maybeSingle();

      const { data: company, error: companyError } = await companyQuery;

      if (companyError) throw companyError;
      if (!company) {
        setLoading(false);
        return;
      }

      setCompanyId(company.id);
      setCompanyName(company.name || 'Loja');
      setCompanySlug(company.slug || '');
      setCompanyStatus(company.status || 'pending');
      setAutoPrintKitchen(!!company.auto_print_kitchen);
      setAutoPrintMode((company.auto_print_mode as 'kitchen' | 'full' | 'both') || 'kitchen');
      setCompanyCnpj(company.cnpj || null);
      setWhatsappNotificationsEnabled(company.whatsapp_notifications_enabled ?? true);

      // Backend safety net: remove any empty/buggy orders for this company
      // Executa em background sem bloquear o carregamento da página
      (async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData.session?.access_token) {
            await supabase.functions.invoke('cleanup-empty-orders', {
              body: { companyId: company.id },
            });
          }
        } catch {
          // Silenciosamente ignora erros - não deve afetar UX
        }
      })();

      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (*),
          customer_addresses:delivery_address_id (*),
          coupons:coupon_id (id, code, discount_type, discount_value),
          customer_referral_codes:referral_code_id (id, code, customers:customer_id (name))
        `)
        .eq('company_id', company.id)
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;
      setOrders(ordersData || []);
    } catch (error: any) {
      console.error('Error loading orders:', error);
      toast({
        title: 'Erro ao carregar pedidos',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Check if NFe is enabled globally
  const checkNfeEnabled = async () => {
    try {
      const { data } = await supabase
        .from('nfe_global_settings')
        .select('is_enabled')
        .limit(1)
        .maybeSingle();
      
      setNfeEnabled(data?.is_enabled ?? false);
    } catch (error) {
      console.error('Error checking NFe status:', error);
    }
  };

  // Check NFe status for delivered orders
  const loadNfeStatuses = async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    
    try {
      const { data } = await supabase
        .from('nfe_invoices')
        .select('order_id, status')
        .in('order_id', orderIds);
      
      if (data) {
        const statusMap: Record<string, string> = {};
        data.forEach((item) => {
          if (item.order_id) {
            statusMap[item.order_id] = item.status;
          }
        });
        setOrderNfeStatus(statusMap);
      }
    } catch (error) {
      console.error('Error loading NFe statuses:', error);
    }
  };

  // Issue NFe for an order
  const issueNfe = async (orderId: string) => {
    if (!companyId) return;
    
    setIssuingNfe(true);
    try {
      // Create pending NFe record
      const { error } = await supabase
        .from('nfe_invoices')
        .insert({
          company_id: companyId,
          order_id: orderId,
          status: 'pending',
        });
      
      if (error) throw error;
      
      // Update local status
      setOrderNfeStatus((prev) => ({ ...prev, [orderId]: 'pending' }));
      
      toast({
        title: 'NFe solicitada',
        description: 'A nota fiscal está sendo processada. Acompanhe em Notas Fiscais.',
      });
    } catch (error: any) {
      console.error('Error issuing NFe:', error);
      toast({
        title: 'Erro ao emitir NFe',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIssuingNfe(false);
    }
  };

  // Load NFe status when orders change
  useEffect(() => {
    checkNfeEnabled();
  }, []);

  useEffect(() => {
    const deliveredOrderIds = orders
      .filter((o) => o.status === 'delivered')
      .map((o) => o.id);
    loadNfeStatuses(deliveredOrderIds);
  }, [orders]);

  const loadAvailableDrivers = async () => {
    if (!companyId) return;
    
    try {
      const { data, error } = await supabase
        .from('delivery_drivers')
        .select('id, driver_name, driver_phone, is_available, driver_status')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('driver_name');

      if (error) throw error;
      setAvailableDrivers(data || []);
    } catch (error) {
      console.error('Error loading drivers:', error);
    }
  };

  const sendWhatsappToDriver = async (orderId: string, driverId: string) => {
    if (typeof window === 'undefined') return;

    const driver = availableDrivers.find((d) => d.id === driverId);

    if (!driver?.driver_phone) {
      console.log('Entregador sem telefone cadastrado');
      return;
    }

    try {
      // Buscar dados completos do pedido diretamente do banco
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (*),
          customer_addresses:delivery_address_id (*)
        `)
        .eq('id', orderId)
        .single();

      if (orderError || !orderData) {
        console.error('Erro ao buscar pedido para WhatsApp:', orderError);
        return;
      }

      const rawPhone = driver.driver_phone.replace(/\D/g, '');
      let phone = rawPhone;
      if (!phone.startsWith('55')) {
        phone = `55${phone}`;
      }

      const address = orderData.customer_addresses as DeliveryAddress | null;
      const addressParts = address
        ? [
            `${address.street}, ${address.number}`,
            address.complement ? `(${address.complement})` : null,
            address.neighborhood,
            `${address.city} - ${address.state}`,
            address.reference ? `Referência: ${address.reference}` : null,
          ].filter(Boolean)
        : [];
      const addressStr = addressParts.length > 0
        ? addressParts.join(', ')
        : 'Endereço não informado';

      const total = Number(orderData.total) || 0;
      const formattedTotal = total.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });

      const items = orderData.order_items || [];

      const messageLines = [
        `*Novo pedido #${orderData.id.slice(0, 8)}*`,
        '',
        `*Cliente:* ${orderData.customer_name}`,
        `*Telefone:* ${orderData.customer_phone}`,
        `*Endereço:* ${addressStr}`,
        '',
      ];

      if (items.length > 0) {
        messageLines.push('*Itens do pedido:*');
        items.forEach((item: OrderItem) => {
          const options = Array.isArray(item.options) ? item.options : [];
          let line = `- ${item.quantity}x ${item.product_name}`;
          if (options.length > 0) {
            line += ` (${options.map((o: any) => o.name).join(', ')})`;
          }
          if (item.notes) {
            line += ` - Obs: ${item.notes}`;
          }
          messageLines.push(line);
        });
        messageLines.push('');
      }

      // Forma de pagamento
      const paymentLabel = paymentMethodLabels[orderData.payment_method as PaymentMethod] || orderData.payment_method;
      messageLines.push(`*Pagamento:* ${paymentLabel}`);

      if (orderData.needs_change && orderData.change_for) {
        const changeFor = Number(orderData.change_for).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        messageLines.push(`*Troco para:* ${changeFor}`);
      }

      messageLines.push(`*Total:* ${formattedTotal}`);

      if (orderData.notes) {
        messageLines.push('');
        messageLines.push(`*Observações:* ${orderData.notes}`);
      }

      if (address && addressStr !== 'Endereço não informado') {
        const fullAddress = `${address.street}, ${address.number}, ${address.neighborhood}, ${address.city} - ${address.state}`;
        const routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`;
        messageLines.push('');
        messageLines.push(`Rota no mapa: ${routeUrl}`);
      }

      const message = encodeURIComponent(messageLines.join('\n'));
      const whatsappUrl = `https://wa.me/${phone}?text=${message}`;

      console.log('Abrindo WhatsApp para entregador:', whatsappUrl);
      window.open(whatsappUrl, '_blank');
    } catch (error) {
      console.error('Erro ao montar link do WhatsApp para o entregador:', error);
    }
  };
  const assignDriverToOrder = async (orderId: string, driverId: string) => {
    if (!companyId) return;
    
    setAssigningDriver(true);
    try {
      const { data, error } = await supabase.functions.invoke('assign-driver', {
        body: { orderId, driverId, companyId }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Entregador atribuído',
        description: data.driverName ? `${data.driverName} foi atribuído ao pedido` : 'Entregador atribuído com sucesso',
      });

      // Send push notification to driver
      const order = orders.find(o => o.id === orderId);
      if (order && data.driverName) {
        const address = (order as any).customer_addresses;
        const addressStr = address 
          ? `${address.street}, ${address.number} - ${address.neighborhood}` 
          : 'Endereço não informado';
        
        await notifyDriverNewOrder(
          orderId,
          driverId,
          order.customer_name,
          addressStr
        );
      }

      // Abrir WhatsApp com mensagem pronta para o entregador
      sendWhatsappToDriver(orderId, driverId);

      // Reload orders to get updated data
      loadCompanyAndOrders();
      loadAvailableDrivers();
      setSelectedOrder(null);
    } catch (error: any) {
      const rawMessage: string = error?.message || 'Ocorreu um erro ao atribuir o entregador.';
      const isInactive = rawMessage.includes('DRIVER_INACTIVE');

      toast({
        title: 'Erro ao atribuir entregador',
        description: isInactive
          ? 'Este entregador está inativo. Ative-o na tela de Entregadores para poder receber pedidos.'
          : rawMessage,
        variant: 'destructive',
      });
    } finally {
      setAssigningDriver(false);
    }
  };
  // Broadcast order to all available drivers - competitive system
  const broadcastOrderToDrivers = async (orderId: string) => {
    if (!companyId) return;

    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    if (order.status !== 'ready') {
      toast({
        title: 'Pedido ainda não está pronto',
        description: 'Você só pode enviar pedidos para entregadores quando o status for "Pronto".',
        variant: 'destructive',
      });
      return;
    }
    
    setAssigningDriver(true);
    try {
      const { data, error } = await supabase.functions.invoke('broadcast-order-offers', {
        body: { orderId, companyId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data.offersCreated === 0) {
        toast({
          title: 'Nenhum entregador disponível',
          description: 'Não há entregadores online no momento. Tente novamente mais tarde.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Pedido enviado para entregadores',
          description: `${data.offersCreated} entregador(es) notificado(s): ${data.driverNames?.join(', ')}`,
        });
      }

      loadCompanyAndOrders();
      loadAvailableDrivers();
      setSelectedOrder(null);
    } catch (error: any) {
      toast({
        title: 'Erro ao enviar para entregadores',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setAssigningDriver(false);
    }
  };
  const reassignDriverToOrder = async (orderId: string, newDriverId: string) => {
    if (!companyId) return;
    
    setAssigningDriver(true);
    try {
      // First, get current order to free up the previous driver and cancel pending offers
      const order = orders.find(o => o.id === orderId);
      const previousDriverId = order?.delivery_driver_id;
      const previousDriver = availableDrivers.find(d => d.id === previousDriverId);
      const newDriver = availableDrivers.find(d => d.id === newDriverId);

      if (order?.delivery_driver_id) {
        // Free up previous driver
        await supabase
          .from('delivery_drivers')
          .update({ 
            driver_status: 'available',
            is_available: true
          })
          .eq('id', order.delivery_driver_id);
      }

      // Cancel any pending offers for this order
      await supabase
        .from('order_offers')
        .update({ status: 'cancelled' })
        .eq('order_id', orderId)
        .eq('status', 'pending');

      // Assign new driver using the edge function
      const { data, error } = await supabase.functions.invoke('assign-driver', {
        body: { orderId, driverId: newDriverId, companyId }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Log activity
      await logActivity({
        actionType: 'assign',
        entityType: 'order',
        entityId: orderId,
        entityName: `Pedido #${orderId.slice(0, 8)}`,
        description: `Entregador reatribuído de ${previousDriver?.driver_name || 'N/A'} para ${newDriver?.driver_name || data.driverName}`,
        oldData: previousDriverId ? { driver_id: previousDriverId, driver_name: previousDriver?.driver_name } : null,
        newData: { driver_id: newDriverId, driver_name: newDriver?.driver_name || data.driverName },
      });

      toast({
        title: 'Entregador reatribuído',
        description: data.driverName ? `${data.driverName} foi atribuído ao pedido` : 'Entregador reatribuído com sucesso',
      });

      // Abrir WhatsApp com mensagem pronta para o novo entregador
      sendWhatsappToDriver(orderId, newDriverId);

      // Reload data
      loadCompanyAndOrders();
      loadAvailableDrivers();
      setSelectedOrder(null);
    } catch (error: any) {
      const rawMessage: string = error?.message || 'Ocorreu um erro ao reatribuir o entregador.';
      const isInactive = rawMessage.includes('DRIVER_INACTIVE');

      toast({
        title: 'Erro ao reatribuir entregador',
        description: isInactive
          ? 'Este entregador está inativo. Ative-o na tela de Entregadores para poder receber pedidos.'
          : rawMessage,
        variant: 'destructive',
      });
    } finally {
      setAssigningDriver(false);
    }
  };
  const loadOrderDetails = async (orderId: string, attempt: number = 1) => {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*),
        customer_addresses:delivery_address_id (*),
        coupons:coupon_id (id, code, discount_type, discount_value),
        customer_referral_codes:referral_code_id (id, code, customers:customer_id (name))
      `)
      .eq('id', orderId)
      .single();

    if (!error && data) {
      const hasItems = Array.isArray(data.order_items) && data.order_items.length > 0;

      // Se ainda não houver itens, tenta novamente algumas vezes para evitar mostrar "0 itens"
      if (!hasItems && attempt < 5) {
        setTimeout(() => {
          loadOrderDetails(orderId, attempt + 1);
        }, 400);
        return;
      }

      setOrders((prev) => {
        const exists = prev.find((o) => o.id === data.id);
        if (exists) {
          return prev.map((o) => (o.id === data.id ? data : o));
        }
        return [data, ...prev];
      });
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    setUpdatingStatus(true);
    try {
      // Get order details for notification and printing
      const order = orders.find((o) => o.id === orderId);
      const oldStatus = order?.status;

      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId);

      if (error) throw error;

      // Log activity
      await logActivity({
        actionType: 'status_change',
        entityType: 'order',
        entityId: orderId,
        entityName: `Pedido #${orderId.slice(0, 8)}`,
        description: `Status alterado de "${oldStatus ? statusConfig[oldStatus].label : 'N/A'}" para "${statusConfig[newStatus].label}"`,
        oldData: { status: oldStatus },
        newData: { status: newStatus },
      });

      toast({
        title: 'Status atualizado',
        description: `Pedido alterado para "${statusConfig[newStatus].label}"`,
      });

      // Send push notification to customer
      if (order && companySlug) {
        await notifyOrderStatusChange(
          orderId,
          newStatus,
          order.customer_name,
          companySlug
        );
      }

      // Update local state
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus } : null));
      }

      // Auto print kitchen ticket when order is confirmed and setting is enabled
      if (newStatus === 'confirmed' && autoPrintKitchen && order) {
        setAutoPrintTrigger((prev) => prev + 1);
      }

      // Show WhatsApp dialog to notify customer (except for cancelled, and only if enabled)
      if (order && newStatus !== 'cancelled' && whatsappNotificationsEnabled) {
        setWhatsappOrder({ order: { ...order, status: newStatus }, newStatus });
        setShowWhatsappDialog(true);
      }
    } catch (error: any) {
      toast({
        title: 'Erro ao atualizar',
        description: error.message,
        variant: 'destructive',
      });
      throw error; // important so callers can react
    } finally {
      setUpdatingStatus(false);
    }
  };

  const sendWhatsappToCustomer = (order: Order, status: OrderStatus) => {
    if (typeof window === 'undefined') return;

    const rawPhone = order.customer_phone.replace(/\D/g, '');
    let phone = rawPhone;
    if (!phone.startsWith('55')) {
      phone = `55${phone}`;
    }

    const statusLabel = statusConfig[status].label;
    const statusMessage = statusMessages[status];
    
    const messageLines = [
      `Olá, ${order.customer_name}! 👋`,
      '',
      `*Atualização do pedido #${order.id.slice(0, 8)}*`,
      '',
      `📦 *Status:* ${statusLabel}`,
      '',
      statusMessage,
      '',
      `💰 *Total:* ${Number(order.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    ];

    if (status === 'out_for_delivery') {
      messageLines.push('');
      messageLines.push('Fique atento! O entregador está a caminho.');
    }

    if (status === 'delivered') {
      messageLines.push('');
      messageLines.push('Esperamos que tenha gostado! Volte sempre! 💜');
    }

    messageLines.push('');
    messageLines.push(`- ${companyName}`);

    const message = encodeURIComponent(messageLines.join('\n'));
    const whatsappUrl = `https://wa.me/${phone}?text=${message}`;

    console.log('Abrindo WhatsApp para cliente:', whatsappUrl);
    window.open(whatsappUrl, '_blank');
    setShowWhatsappDialog(false);
    setWhatsappOrder(null);
  };

  const cancelOrder = async (order: typeof orders[number], reason: string) => {
    setUpdatingStatus(true);
    try {
      // If this is a legacy/buggy order without items, delete it entirely
      if (!order.order_items || order.order_items.length === 0) {
        try {
          await supabase.from('order_items').delete().eq('order_id', order.id);
        } catch (itemsError) {
          console.error('Error deleting orphan order items:', itemsError);
        }

        const { error: deleteError } = await supabase
          .from('orders')
          .delete()
          .eq('id', order.id);

        if (deleteError) throw deleteError;

        setOrders((prev) => prev.filter((o) => o.id !== order.id));

        // Log activity
        await logActivity({
          actionType: 'delete',
          entityType: 'order',
          entityId: order.id,
          entityName: `Pedido #${order.id.slice(0, 8)}`,
          description: `Pedido inválido sem itens foi removido. Motivo: ${reason}`,
          oldData: { status: order.status, customer: order.customer_name },
        });

        toast({
          title: 'Pedido removido',
          description: 'Pedido inválido sem itens foi removido.',
        });
      } else {
        // Normal flow: update status to cancelled and save reason
        const { error } = await supabase
          .from('orders')
          .update({ 
            status: 'cancelled',
            cancellation_reason: reason 
          })
          .eq('id', order.id);

        if (error) throw error;

        // Update local state
        setOrders((prev) =>
          prev.map((o) => 
            o.id === order.id 
              ? { ...o, status: 'cancelled' as const, cancellation_reason: reason } 
              : o
          )
        );

        // Log cancellation
        await logActivity({
          actionType: 'status_change',
          entityType: 'order',
          entityId: order.id,
          entityName: `Pedido #${order.id.slice(0, 8)}`,
          description: `Pedido cancelado (cliente: ${order.customer_name}). Motivo: ${reason}`,
          oldData: { status: order.status },
          newData: { status: 'cancelled', cancellation_reason: reason },
        });

        toast({
          title: 'Pedido cancelado',
          description: 'O pedido foi cancelado com sucesso.',
        });
      }

      // Close dialogs after successful cancellation/removal
      setSelectedOrder(null);
      setShowCancelDialog(false);
      setOrderToCancel(null);
    } catch (error: any) {
      console.error('Error cancelling order:', error);
      toast({
        title: 'Erro ao cancelar pedido',
        description: error.message || 'Tente novamente',
        variant: 'destructive',
      });
    } finally {
      setUpdatingStatus(false);
    }
  };
  const getNextStatus = (currentStatus: OrderStatus, source?: string): OrderStatus | null => {
    // Usa fluxo diferente para pedidos de mesa ou retirada
    let flow = statusFlow;
    if (source === 'table') flow = tableStatusFlow;
    else if (source === 'pickup') flow = pickupStatusFlow;
    
    const currentIndex = flow.indexOf(currentStatus);
    if (currentIndex === -1 || currentIndex === flow.length - 1) return null;
    return flow[currentIndex + 1];
  };

  // Função para converter pedido de retirada para delivery
  const convertToDelivery = async () => {
    if (!selectedOrder) return;
    
    // Validar campos obrigatórios do endereço
    if (!deliveryAddress.street.trim() || !deliveryAddress.number.trim() || 
        !deliveryAddress.neighborhood.trim() || !deliveryAddress.city.trim() || 
        !deliveryAddress.state.trim()) {
      toast({
        title: 'Endereço incompleto',
        description: 'Preencha os campos obrigatórios: Rua, Número, Bairro, Cidade e Estado.',
        variant: 'destructive',
      });
      return;
    }
    
    setConvertingToDelivery(true);
    try {
      // Primeiro, criar o endereço de entrega
      const { data: addressData, error: addressError } = await supabase
        .from('customer_addresses')
        .insert({
          customer_id: selectedOrder.customer_id || null,
          street: deliveryAddress.street.trim(),
          number: deliveryAddress.number.trim(),
          complement: deliveryAddress.complement.trim() || null,
          neighborhood: deliveryAddress.neighborhood.trim(),
          city: deliveryAddress.city.trim(),
          state: deliveryAddress.state.trim(),
          zip_code: deliveryAddress.zip_code.trim() || '',
          reference: deliveryAddress.reference.trim() || null,
        })
        .select()
        .single();
      
      if (addressError) throw addressError;
      
      // Depois, atualizar o pedido com o endereço e converter para delivery
      const { error } = await supabase
        .from('orders')
        .update({ 
          source: 'pos', // Muda de pickup para pos (delivery via PDV)
          delivery_fee: companyData?.delivery_fee || 0,
          total: selectedOrder.subtotal + (companyData?.delivery_fee || 0),
          delivery_address_id: addressData.id,
        })
        .eq('id', selectedOrder.id);
      
      if (error) throw error;
      
      // Atualiza localmente
      setOrders(prev => prev.map(o => 
        o.id === selectedOrder.id 
          ? { 
              ...o, 
              source: 'pos',
              delivery_fee: companyData?.delivery_fee || 0,
              total: selectedOrder.subtotal + (companyData?.delivery_fee || 0),
              delivery_address_id: addressData.id,
              customer_addresses: addressData,
            } 
          : o
      ));
      setSelectedOrder(prev => prev ? { 
        ...prev, 
        source: 'pos',
        delivery_fee: companyData?.delivery_fee || 0,
        total: selectedOrder.subtotal + (companyData?.delivery_fee || 0),
        delivery_address_id: addressData.id,
        customer_addresses: addressData,
      } : null);
      
      toast({
        title: 'Pedido convertido',
        description: 'O pedido foi alterado para delivery com o endereço informado.',
      });
      
      // Limpar formulário
      setDeliveryAddress({
        street: '',
        number: '',
        complement: '',
        neighborhood: '',
        city: '',
        state: '',
        zip_code: '',
        reference: '',
      });
      
      setShowConvertToDeliveryDialog(false);
    } catch (error: any) {
      console.error('Error converting to delivery:', error);
      toast({
        title: 'Erro ao converter',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setConvertingToDelivery(false);
    }
  };

  // Buscar dados da empresa para taxa de entrega
  const [companyData, setCompanyData] = useState<{ delivery_fee: number } | null>(null);
  
  useEffect(() => {
    const loadCompanyData = async () => {
      if (!companyId) return;
      const { data } = await supabase
        .from('companies')
        .select('delivery_fee')
        .eq('id', companyId)
        .maybeSingle();
      if (data) setCompanyData(data);
    };
    loadCompanyData();
  }, [companyId]);

  const isWithinPeriod = (dateString: string): boolean => {
    if (periodFilter === 'all') return true;
    
    const orderDate = new Date(dateString);
    const now = new Date();
    
    switch (periodFilter) {
      case 'today':
        return isAfter(orderDate, startOfDay(now));
      case 'week':
        return isAfter(orderDate, startOfWeek(now, { weekStartsOn: 0 }));
      case 'month':
        return isAfter(orderDate, startOfMonth(now));
      default:
        return true;
    }
  };

  const filteredOrders = orders.filter((order) => {
    // Primeiro filtra por status/source
    if (statusFilter === 'active') {
      return !['delivered', 'cancelled'].includes(order.status);
    }
    if (statusFilter === 'completed') {
      // Aplica filtro de período apenas para entregues
      return order.status === 'delivered' && isWithinPeriod(order.created_at);
    }
    if (statusFilter === 'cancelled') {
      // Aplica filtro de período apenas para cancelados
      return order.status === 'cancelled' && isWithinPeriod(order.created_at);
    }
    if (statusFilter === 'pickup') {
      // Filtra pedidos de retirada (ativos)
      return order.source === 'pickup' && !['delivered', 'cancelled'].includes(order.status);
    }
    if (statusFilter === 'pos') {
      // Filtra pedidos do PDV (ativos)
      return order.source === 'pos' && !['delivered', 'cancelled'].includes(order.status);
    }
    if (statusFilter === 'table') {
      // Filtra pedidos de mesa (ativos)
      return order.source === 'table' && !['delivered', 'cancelled'].includes(order.status);
    }
    return true;
  });

  const ordersByStatus = {
    pending: filteredOrders.filter((o) => o.status === 'pending'),
    confirmed: filteredOrders.filter((o) => o.status === 'confirmed'),
    preparing: filteredOrders.filter((o) => o.status === 'preparing'),
    ready: filteredOrders.filter((o) => o.status === 'ready'),
    awaiting_driver: filteredOrders.filter((o) => o.status === 'awaiting_driver'),
    out_for_delivery: filteredOrders.filter((o) => o.status === 'out_for_delivery'),
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!companyId) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-medium mb-2">Nenhuma loja encontrada</h2>
            <p className="text-muted-foreground text-center mb-4">
              Você precisa cadastrar sua loja antes de gerenciar pedidos
            </p>
            <Button asChild>
              <a href="/dashboard/store">Cadastrar Loja</a>
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  if (companyStatus !== 'approved') {
    return (
      <DashboardLayout>
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-amber-400/20 rounded-full blur-xl animate-pulse" />
              <div className="relative bg-amber-100 dark:bg-amber-900/50 p-6 rounded-full">
                <Lock className="h-12 w-12 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            <h2 className="text-xl font-semibold mb-3 text-center">
              Aguardando aprovação
            </h2>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Sua loja está em análise pela nossa equipe. Assim que for aprovada, 
              você poderá receber e gerenciar pedidos aqui.
            </p>
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-4 py-2 rounded-full">
              <Clock className="h-4 w-4" />
              <span>Geralmente respondemos em até 24 horas</span>
            </div>
            <div className="mt-8 flex gap-3">
              <Button variant="outline" asChild>
                <a href="/dashboard/store">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Verificar configurações
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/dashboard">Voltar ao início</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* Alerta de status da conexão realtime */}
      <RealtimeConnectionAlert
        connectionStatus={connectionStatus}
        isPollingActive={isPollingActive}
        reconnectAttempts={reconnectAttempts}
        onForceReconnect={forceReconnect}
      />

      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-display">Pedidos</h1>
            <p className="text-muted-foreground">
              Gerencie os pedidos da sua loja em tempo real
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadCompanyAndOrders}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Atualizar
            </Button>
            <Button size="sm" onClick={() => navigate('/dashboard/orders/new')}>
              <PlusCircle className="h-4 w-4 mr-2" />
              Novo Pedido
            </Button>
          </div>
        </div>

        {/* Subscription Alert */}
        {subscriptionStatus && (subscriptionStatus.isNearLimit || subscriptionStatus.isAtLimit) && (
          <SubscriptionAlert
            plan={subscriptionStatus.plan}
            revenueLimit={subscriptionStatus.revenueLimit}
            monthlyRevenue={subscriptionStatus.monthlyRevenue}
            displayName={subscriptionStatus.displayName}
            isNearLimit={subscriptionStatus.isNearLimit}
            isAtLimit={subscriptionStatus.isAtLimit}
            usagePercentage={subscriptionStatus.usagePercentage}
            recommendedPlan={subscriptionStatus.recommendedPlan}
          />
        )}

        {/* Payment Methods Indicator */}
        <PaymentMethodsIndicator orders={orders} />


        {/* Tabs */}
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="active" className="gap-2">
              <Bell className="h-4 w-4" />
              Ativos ({orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length})
            </TabsTrigger>
            <TabsTrigger value="pickup" className="gap-2">
              <Store className="h-4 w-4" />
              Retirada ({orders.filter((o) => o.source === 'pickup' && !['delivered', 'cancelled'].includes(o.status)).length})
            </TabsTrigger>
            <TabsTrigger value="pos" className="gap-2">
              <CreditCard className="h-4 w-4" />
              PDV ({orders.filter((o) => o.source === 'pos' && !['delivered', 'cancelled'].includes(o.status)).length})
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-2">
              <UtensilsCrossed className="h-4 w-4" />
              Mesa ({orders.filter((o) => o.source === 'table' && !['delivered', 'cancelled'].includes(o.status)).length})
            </TabsTrigger>
            <TabsTrigger value="completed">
              Entregues ({orders.filter((o) => o.status === 'delivered').length})
            </TabsTrigger>
            <TabsTrigger value="cancelled">
              Cancelados ({orders.filter((o) => o.status === 'cancelled').length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-6">
            {/* Kanban-style view for active orders */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 h-[calc(100vh-320px)] min-h-[400px]">
              {(['pending', 'confirmed', 'preparing', 'ready', 'awaiting_driver', 'out_for_delivery'] as OrderStatus[]).map(
                (status) => {
                  const StatusIcon = statusConfig[status].icon;
                  return (
                    <div key={status} className="flex flex-col h-full min-h-0">
                      {/* Column header */}
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 shrink-0">
                        <div className={`p-1.5 rounded-md ${statusConfig[status].color}/20`}>
                          <StatusIcon className={`h-4 w-4 ${statusConfig[status].color.replace('bg-', 'text-').replace('-500', '-600')}`} />
                        </div>
                        <h3 className="font-medium text-sm flex-1">{statusConfig[status].label}</h3>
                        <Badge variant="secondary" className="font-semibold">
                          {ordersByStatus[status]?.length || 0}
                        </Badge>
                      </div>
                      
                      {/* Orders list with scroll */}
                      <div className="flex-1 overflow-y-auto mt-3 space-y-3 scrollbar-hide">
                        {ordersByStatus[status]?.map((order) => (
                          <OrderCard
                            key={order.id}
                            order={order}
                            onClick={() => setSelectedOrder(order)}
                          />
                        ))}
                        {(ordersByStatus[status]?.length || 0) === 0 && (
                          <div className="p-6 text-center text-sm text-muted-foreground/60 border-2 border-dashed border-muted/50 rounded-xl bg-muted/10">
                            <Package className="h-6 w-6 mx-auto mb-2 opacity-40" />
                            <span>Sem pedidos</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </TabsContent>

          <TabsContent value="pickup" className="mt-6">
            {/* Kanban-style view for pickup orders */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 h-[calc(100vh-320px)] min-h-[400px]">
              {(['pending', 'confirmed', 'preparing', 'ready', 'awaiting_driver', 'out_for_delivery'] as OrderStatus[]).map(
                (status) => {
                  const StatusIcon = statusConfig[status].icon;
                  const statusOrders = filteredOrders.filter((o) => o.status === status);
                  return (
                    <div key={status} className="flex flex-col h-full min-h-0">
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 shrink-0">
                        <div className={`p-1.5 rounded-md ${statusConfig[status].color}/20`}>
                          <StatusIcon className={`h-4 w-4 ${statusConfig[status].color.replace('bg-', 'text-').replace('-500', '-600')}`} />
                        </div>
                        <h3 className="font-medium text-sm flex-1">{statusConfig[status].label}</h3>
                        <Badge variant="secondary" className="font-semibold">
                          {statusOrders.length}
                        </Badge>
                      </div>
                      <div className="flex-1 overflow-y-auto mt-3 space-y-3 scrollbar-hide">
                        {statusOrders.map((order) => (
                          <OrderCard
                            key={order.id}
                            order={order}
                            onClick={() => setSelectedOrder(order)}
                          />
                        ))}
                        {statusOrders.length === 0 && (
                          <div className="p-6 text-center text-sm text-muted-foreground/60 border-2 border-dashed border-muted/50 rounded-xl bg-muted/10">
                            <Package className="h-6 w-6 mx-auto mb-2 opacity-40" />
                            <span>Sem pedidos</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </TabsContent>

          <TabsContent value="pos" className="mt-6">
            {/* Kanban-style view for POS orders */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 h-[calc(100vh-320px)] min-h-[400px]">
              {(['pending', 'confirmed', 'preparing', 'ready', 'awaiting_driver', 'out_for_delivery'] as OrderStatus[]).map(
                (status) => {
                  const StatusIcon = statusConfig[status].icon;
                  const statusOrders = filteredOrders.filter((o) => o.status === status);
                  return (
                    <div key={status} className="flex flex-col h-full min-h-0">
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 shrink-0">
                        <div className={`p-1.5 rounded-md ${statusConfig[status].color}/20`}>
                          <StatusIcon className={`h-4 w-4 ${statusConfig[status].color.replace('bg-', 'text-').replace('-500', '-600')}`} />
                        </div>
                        <h3 className="font-medium text-sm flex-1">{statusConfig[status].label}</h3>
                        <Badge variant="secondary" className="font-semibold">
                          {statusOrders.length}
                        </Badge>
                      </div>
                      <div className="flex-1 overflow-y-auto mt-3 space-y-3 scrollbar-hide">
                        {statusOrders.map((order) => (
                          <OrderCard
                            key={order.id}
                            order={order}
                            onClick={() => setSelectedOrder(order)}
                          />
                        ))}
                        {statusOrders.length === 0 && (
                          <div className="p-6 text-center text-sm text-muted-foreground/60 border-2 border-dashed border-muted/50 rounded-xl bg-muted/10">
                            <Package className="h-6 w-6 mx-auto mb-2 opacity-40" />
                            <span>Sem pedidos</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </TabsContent>

          <TabsContent value="table" className="mt-6">
            {/* Kanban-style view for table orders */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 h-[calc(100vh-320px)] min-h-[400px]">
              {(['pending', 'confirmed', 'preparing', 'ready', 'awaiting_driver', 'out_for_delivery'] as OrderStatus[]).map(
                (status) => {
                  const StatusIcon = statusConfig[status].icon;
                  const statusOrders = filteredOrders.filter((o) => o.status === status);
                  return (
                    <div key={status} className="flex flex-col h-full min-h-0">
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 shrink-0">
                        <div className={`p-1.5 rounded-md ${statusConfig[status].color}/20`}>
                          <StatusIcon className={`h-4 w-4 ${statusConfig[status].color.replace('bg-', 'text-').replace('-500', '-600')}`} />
                        </div>
                        <h3 className="font-medium text-sm flex-1">{statusConfig[status].label}</h3>
                        <Badge variant="secondary" className="font-semibold">
                          {statusOrders.length}
                        </Badge>
                      </div>
                      <div className="flex-1 overflow-y-auto mt-3 space-y-3 scrollbar-hide">
                        {statusOrders.map((order) => (
                          <OrderCard
                            key={order.id}
                            order={order}
                            onClick={() => setSelectedOrder(order)}
                          />
                        ))}
                        {statusOrders.length === 0 && (
                          <div className="p-6 text-center text-sm text-muted-foreground/60 border-2 border-dashed border-muted/50 rounded-xl bg-muted/10">
                            <Package className="h-6 w-6 mx-auto mb-2 opacity-40" />
                            <span>Sem pedidos</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </TabsContent>

          <TabsContent value="completed" className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {filteredOrders.length} pedido(s) entregue(s)
              </p>
              <Select value={periodFilter} onValueChange={(value) => setPeriodFilter(value as PeriodFilter)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="week">Esta semana</SelectItem>
                  <SelectItem value="month">Este mês</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <OrdersList
              orders={filteredOrders}
              onViewOrder={setSelectedOrder}
            />
          </TabsContent>

          <TabsContent value="cancelled" className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {filteredOrders.length} pedido(s) cancelado(s)
              </p>
              <Select value={periodFilter} onValueChange={(value) => setPeriodFilter(value as PeriodFilter)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="week">Esta semana</SelectItem>
                  <SelectItem value="month">Este mês</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <OrdersList
              orders={filteredOrders}
              onViewOrder={setSelectedOrder}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Order Details Modal */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="font-display">
                Pedido #{selectedOrder?.id.slice(0, 8)}
              </DialogTitle>
              {selectedOrder && (
                <PrintReceipt
                  order={selectedOrder}
                  companyName={companyName}
                  autoPrintEnabled={autoPrintKitchen}
                  autoPrintMode={autoPrintMode}
                  autoPrintTrigger={autoPrintTrigger}
                />
              )}
            </div>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-6">
              {/* Source Badge - Destacado */}
              <div className="flex justify-center">
                {selectedOrder.source === 'pos' && (
                  <Badge className="text-sm px-4 py-1.5 bg-violet-500 text-white font-semibold">
                    <Store className="h-4 w-4 mr-2" />
                    Pedido PDV
                  </Badge>
                )}
                {selectedOrder.source === 'table' && (
                  <Badge className="text-sm px-4 py-1.5 bg-amber-500 text-white font-semibold">
                    <UtensilsCrossed className="h-4 w-4 mr-2" />
                    Pedido Mesa
                  </Badge>
                )}
                {selectedOrder.source === 'pickup' && (
                  <Badge className="text-sm px-4 py-1.5 bg-emerald-500 text-white font-semibold">
                    <Package className="h-4 w-4 mr-2" />
                    Retirada no Balcão
                  </Badge>
                )}
                {(!selectedOrder.source || selectedOrder.source === 'online') && (
                  <Badge className="text-sm px-4 py-1.5 bg-sky-500 text-white font-semibold">
                    <Smartphone className="h-4 w-4 mr-2" />
                    Pedido Online
                  </Badge>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${statusConfig[selectedOrder.status].color}`} />
                  <span className="font-medium">{getStatusLabel(selectedOrder.status, selectedOrder.source)}</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(selectedOrder.created_at), {
                    addSuffix: true,
                    locale: ptBR,
                  })}
                </span>
              </div>

              {/* Status Actions */}
              {selectedOrder.status !== 'delivered' && selectedOrder.status !== 'cancelled' && (
                <div className="flex gap-2">
                  {getNextStatus(selectedOrder.status, selectedOrder.source) && (
                    <Button
                      className="flex-1 gradient-primary text-primary-foreground"
                      onClick={() =>
                        updateOrderStatus(
                          selectedOrder.id,
                          getNextStatus(selectedOrder.status, selectedOrder.source)!
                        )
                      }
                      disabled={updatingStatus}
                    >
                      {updatingStatus && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Avançar para "{getStatusLabel(getNextStatus(selectedOrder.status, selectedOrder.source)!, selectedOrder.source)}"
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    disabled={updatingStatus}
                    onClick={() => {
                      setOrderToCancel(selectedOrder);
                      setShowCancelDialog(true);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              )}

              {/* Converter para Delivery - só aparece para retirada */}
              {selectedOrder.source === 'pickup' && selectedOrder.status !== 'delivered' && selectedOrder.status !== 'cancelled' && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowConvertToDeliveryDialog(true)}
                >
                  <Truck className="h-4 w-4 mr-2" />
                  Converter para Delivery
                </Button>
              )}

              <Separator />

              {/* Customer Info */}
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-muted-foreground">Cliente</h4>
                <p className="font-medium">{selectedOrder.customer_name}</p>
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${selectedOrder.customer_phone}`} className="hover:underline">
                    {selectedOrder.customer_phone}
                  </a>
                </div>
                {selectedOrder.customer_email && (
                  <p className="text-sm text-muted-foreground">{selectedOrder.customer_email}</p>
                )}
              </div>

              {/* Address */}
              {selectedOrder.customer_addresses && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Endereço de Entrega
                  </h4>
                  <p className="text-sm">
                    {selectedOrder.customer_addresses.street}, {selectedOrder.customer_addresses.number}
                    {selectedOrder.customer_addresses.complement && `, ${selectedOrder.customer_addresses.complement}`}
                  </p>
                  <p className="text-sm">
                    {selectedOrder.customer_addresses.neighborhood} - {selectedOrder.customer_addresses.city}/{selectedOrder.customer_addresses.state}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    CEP: {selectedOrder.customer_addresses.zip_code}
                  </p>
                  {selectedOrder.customer_addresses.reference && (
                    <p className="text-sm text-muted-foreground italic">
                      Ref: {selectedOrder.customer_addresses.reference}
                    </p>
                  )}
                </div>
              )}

              {/* Driver Assignment Section - Apenas para pedidos de entrega (delivery) */}
              {(selectedOrder.status === 'ready' || selectedOrder.status === 'awaiting_driver' || selectedOrder.status === 'out_for_delivery') && 
               selectedOrder.source !== 'table' && 
               selectedOrder.source !== 'pickup' && 
               selectedOrder.source !== 'pos' && (
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    Entregador
                  </h4>
                  
                  {selectedOrder.delivery_driver_id ? (
                    <div className="space-y-3">
                      {/* Current driver info */}
                      {(() => {
                        const currentDriver = availableDrivers.find(d => d.id === selectedOrder.delivery_driver_id);
                        return currentDriver ? (
                          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                            <div>
                              <p className="font-medium">{currentDriver.driver_name || 'Entregador'}</p>
                              {currentDriver.driver_phone && (
                                <p className="text-sm text-muted-foreground">{currentDriver.driver_phone}</p>
                              )}
                              <Badge variant={
                                currentDriver.driver_status === 'in_delivery' ? 'default' :
                                currentDriver.driver_status === 'pending_acceptance' ? 'secondary' :
                                'outline'
                              } className="mt-1">
                                {currentDriver.driver_status === 'in_delivery' ? 'Em entrega' :
                                 currentDriver.driver_status === 'pending_acceptance' ? 'Aguardando aceite' :
                                 currentDriver.driver_status === 'available' ? 'Disponível' : 
                                 currentDriver.driver_status || 'Offline'}
                              </Badge>
                            </div>
                          </div>

                        ) : (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-sm text-muted-foreground">Entregador atribuído</p>
                          </div>
                        );
                    })()}
                        
                      {/* Show reassign option quando não saiu para entrega */}
                      {selectedOrder.status !== 'out_for_delivery' && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm text-amber-600">
                            <AlertTriangle className="h-4 w-4" />
                            <span>Você pode reatribuir este pedido para outro entregador antes da saída para entrega.</span>
                          </div>
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Reatribuir para outro entregador:</p>
                            <div className="grid gap-2">
                              {availableDrivers
                                .filter(d => d.id !== selectedOrder.delivery_driver_id && d.is_available && d.driver_status === 'available')
                                .map((driver) => (
                                  <Button
                                    key={driver.id}
                                    variant="outline"
                                    size="sm"
                                    className="justify-start"
                                    onClick={() => reassignDriverToOrder(selectedOrder.id, driver.id)}
                                    disabled={assigningDriver}
                                  >
                                    {assigningDriver ? (
                                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                      <Users className="h-4 w-4 mr-2" />
                                    )}
                                    {driver.driver_name || 'Entregador'}
                                  </Button>
                                ))}
                              {availableDrivers.filter(d => d.id !== selectedOrder.delivery_driver_id && d.is_available && d.driver_status === 'available').length === 0 && (
                                <p className="text-sm text-muted-foreground">Nenhum outro entregador disponível</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">Nenhum entregador atribuído</p>
 
                      <p className="text-sm font-medium">Atribuir diretamente:</p>
                      {availableDrivers.filter(d => d.is_available && d.driver_status === 'available').length > 0 ? (
                        <div className="grid gap-2">
                          {availableDrivers
                            .filter(d => d.is_available && d.driver_status === 'available')
                            .map((driver) => (
                              <Button
                                key={driver.id}
                                variant="outline"
                                size="sm"
                                className="justify-start"
                                onClick={() => assignDriverToOrder(selectedOrder.id, driver.id)}
                                disabled={assigningDriver}
                              >
                                {assigningDriver ? (
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                  <UserPlus className="h-4 w-4 mr-2" />
                                )}
                                {driver.driver_name || 'Entregador'}
                              </Button>
                            ))}
                        </div>
                      ) : (
                        <p className="text-sm text-amber-600">Nenhum entregador disponível no momento</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Separator />

              {/* Items */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm text-muted-foreground">Itens do Pedido</h4>
                {selectedOrder.order_items?.map((item) => {
                  const options = Array.isArray(item.options) ? item.options as { name: string; priceModifier: number }[] : [];
                  return (
                    <div key={item.id} className="flex justify-between text-sm">
                      <div>
                        <span className="font-medium">{item.quantity}x</span> {item.product_name}
                        {options.length > 0 && (
                          <div className="mt-0.5 ml-1 space-y-0.5">
                            {options.map((o, idx) => (
                              <p key={idx} className="text-xs text-muted-foreground">
                                - {o.name}
                              </p>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <p className="text-xs text-muted-foreground italic">{item.notes}</p>
                        )}
                      </div>
                      <span>R$ {Number(item.total_price).toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>

              {/* Notes */}
              {selectedOrder.notes && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium">Observações:</p>
                  <p className="text-sm text-muted-foreground">{selectedOrder.notes}</p>
                </div>
              )}

              <Separator />

              {/* Totals */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>R$ {Number(selectedOrder.subtotal).toFixed(2)}</span>
                </div>
                {(selectedOrder.discount_amount ?? 0) > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span className="flex items-center gap-1">
                      Desconto
                      {selectedOrder.coupons?.code && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0">
                          {selectedOrder.coupons.code}
                        </Badge>
                      )}
                      {!selectedOrder.coupons?.code && selectedOrder.customer_referral_codes && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                          Indicação{selectedOrder.customer_referral_codes.customers?.name ? ` de ${selectedOrder.customer_referral_codes.customers.name}` : ''}
                        </Badge>
                      )}
                    </span>
                    <span>-R$ {Number(selectedOrder.discount_amount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Taxa de entrega</span>
                  <span>R$ {Number(selectedOrder.delivery_fee).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span className="text-primary">R$ {Number(selectedOrder.total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 items-center gap-2">
                  <span className="text-muted-foreground">Pagamento</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <Badge variant="outline">
                      {paymentMethodLabels[selectedOrder.payment_method]}
                    </Badge>
                    {selectedOrder.payment_method === 'online' && (
                  <Badge 
                        variant={selectedOrder.payment_status === 'paid' ? 'default' : 'secondary'}
                        className={selectedOrder.payment_status === 'paid' ? 'bg-emerald-500 text-white' : selectedOrder.payment_status === 'failed' ? 'bg-destructive text-destructive-foreground' : ''}
                      >
                        {selectedOrder.payment_status === 'paid' && '✓ Pago'}
                        {selectedOrder.payment_status === 'pending' && 'Aguardando'}
                        {selectedOrder.payment_status === 'failed' && 'Falhou'}
                      </Badge>
                    )}
                    {selectedOrder.payment_method === 'pix' && (
                      <Badge 
                        variant={selectedOrder.payment_status === 'paid' ? 'default' : 'secondary'}
                        className={selectedOrder.payment_status === 'paid' ? 'bg-emerald-500 text-white' : selectedOrder.payment_status === 'failed' ? 'bg-destructive text-destructive-foreground' : ''}
                      >
                        {selectedOrder.payment_status === 'paid' && '✓ Pago'}
                        {selectedOrder.payment_status === 'pending' && 'Aguardando'}
                        {selectedOrder.payment_status === 'failed' && 'Falhou'}
                      </Badge>
                    )}
                    {selectedOrder.payment_method === 'cash' && selectedOrder.needs_change && (
                      <Badge variant="secondary">
                        Troco para R$ {Number(selectedOrder.change_for || selectedOrder.total).toFixed(2)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* NFe Button - Only for delivered orders with CNPJ configured */}
              {nfeEnabled && companyCnpj && selectedOrder.status === 'delivered' && (
                <div className="pt-4 border-t">
                  {orderNfeStatus[selectedOrder.id] ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <FileText className="h-4 w-4" />
                        <span>Nota Fiscal:</span>
                        <Badge 
                          variant={orderNfeStatus[selectedOrder.id] === 'authorized' ? 'default' : 'secondary'}
                          className={orderNfeStatus[selectedOrder.id] === 'authorized' ? 'bg-emerald-500' : ''}
                        >
                          {orderNfeStatus[selectedOrder.id] === 'authorized' && 'Emitida'}
                          {orderNfeStatus[selectedOrder.id] === 'pending' && 'Pendente'}
                          {orderNfeStatus[selectedOrder.id] === 'processing' && 'Processando'}
                          {orderNfeStatus[selectedOrder.id] === 'error' && 'Erro'}
                        </Badge>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <a href="/dashboard/nfe">Ver detalhes</a>
                      </Button>
                    </div>
                  ) : (
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => issueNfe(selectedOrder.id)}
                      disabled={issuingNfe}
                    >
                      {issuingNfe ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4 mr-2" />
                      )}
                      Emitir Nota Fiscal
                    </Button>
                  )}
                </div>
              )}
              
              {/* NFe not available message - when enabled but no CNPJ */}
              {nfeEnabled && !companyCnpj && selectedOrder.status === 'delivered' && (
                <div className="pt-4 border-t">
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                    <div className="flex gap-2 items-start">
                      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <div className="text-sm text-amber-800 dark:text-amber-200">
                        <p className="font-medium">CNPJ não configurado</p>
                        <p className="text-xs mt-1">
                          Para emitir notas fiscais, cadastre o CNPJ da sua empresa em{' '}
                          <a href="/dashboard/store" className="underline">Configurações → Fiscal</a>.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Order Dialog */}
      {orderToCancel && (
        <CancelOrderDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          onConfirm={async (reason) => {
            await cancelOrder(orderToCancel, reason);
          }}
          orderNumber={`#${orderToCancel.id.slice(0, 8)}`}
          loading={updatingStatus}
        />
      )}

      {/* Convert to Delivery Dialog */}
      <Dialog open={showConvertToDeliveryDialog} onOpenChange={(open) => {
        setShowConvertToDeliveryDialog(open);
        if (!open) {
          setDeliveryAddress({
            street: '',
            number: '',
            complement: '',
            neighborhood: '',
            city: '',
            state: '',
            zip_code: '',
            reference: '',
          });
        }
      }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              Converter para Delivery
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {companyData?.delivery_fee !== undefined && companyData.delivery_fee > 0 && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm">
                  Será adicionada a taxa de entrega de{' '}
                  <span className="font-semibold text-primary">
                    R$ {Number(companyData.delivery_fee).toFixed(2)}
                  </span>
                </p>
              </div>
            )}
            
            <div className="space-y-4">
              <p className="text-sm font-medium">Endereço de Entrega</p>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="street">Rua *</Label>
                  <Input
                    id="street"
                    placeholder="Nome da rua"
                    value={deliveryAddress.street}
                    onChange={(e) => setDeliveryAddress(prev => ({ ...prev, street: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="number">Número *</Label>
                  <Input
                    id="number"
                    placeholder="Nº"
                    value={deliveryAddress.number}
                    onChange={(e) => setDeliveryAddress(prev => ({ ...prev, number: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="complement">Complemento</Label>
                  <Input
                    id="complement"
                    placeholder="Apto, bloco..."
                    value={deliveryAddress.complement}
                    onChange={(e) => setDeliveryAddress(prev => ({ ...prev, complement: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="neighborhood">Bairro *</Label>
                  <Input
                    id="neighborhood"
                    placeholder="Bairro"
                    value={deliveryAddress.neighborhood}
                    onChange={(e) => setDeliveryAddress(prev => ({ ...prev, neighborhood: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="city">Cidade *</Label>
                  <Input
                    id="city"
                    placeholder="Cidade"
                    value={deliveryAddress.city}
                    onChange={(e) => setDeliveryAddress(prev => ({ ...prev, city: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">Estado *</Label>
                  <Input
                    id="state"
                    placeholder="UF"
                    maxLength={2}
                    value={deliveryAddress.state}
                    onChange={(e) => setDeliveryAddress(prev => ({ ...prev, state: e.target.value.toUpperCase() }))}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="zip_code">CEP</Label>
                  <Input
                    id="zip_code"
                    placeholder="00000-000"
                    value={deliveryAddress.zip_code}
                    onChange={(e) => setDeliveryAddress(prev => ({ ...prev, zip_code: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reference">Referência</Label>
                  <Input
                    id="reference"
                    placeholder="Ponto de referência"
                    value={deliveryAddress.reference}
                    onChange={(e) => setDeliveryAddress(prev => ({ ...prev, reference: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground">
              * Campos obrigatórios
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowConvertToDeliveryDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={convertToDelivery} disabled={convertingToDelivery}>
              {convertingToDelivery && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar Conversão
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Notification Dialog */}
      <Dialog open={showWhatsappDialog} onOpenChange={setShowWhatsappDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-green-600" />
              Avisar cliente no WhatsApp?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {whatsappOrder && (
              <>
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Cliente:</span>
                    <span className="font-medium">{whatsappOrder.order.customer_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Telefone:</span>
                    <span className="font-medium">{whatsappOrder.order.customer_phone}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Novo status:</span>
                    <Badge className={statusConfig[whatsappOrder.newStatus].color}>
                      {statusConfig[whatsappOrder.newStatus].label}
                    </Badge>
                  </div>
                </div>
                
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-800 dark:text-green-200">
                    <span className="font-medium">Mensagem que será enviada:</span>
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300 mt-2 italic">
                    "{statusMessages[whatsappOrder.newStatus]}"
                  </p>
                </div>
              </>
            )}
            
            {/* Tip to disable this feature */}
            <div className="p-2 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground text-center">
                Para desativar este recurso, vá em{' '}
                <Link 
                  to="/dashboard/store?tab=entrega" 
                  className="text-primary hover:underline font-medium"
                  onClick={() => {
                    setShowWhatsappDialog(false);
                    setWhatsappOrder(null);
                  }}
                >
                  Configurações da Loja → Entrega
                </Link>
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowWhatsappDialog(false);
                setWhatsappOrder(null);
              }}
            >
              Não enviar
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={() => {
                if (whatsappOrder) {
                  sendWhatsappToCustomer(whatsappOrder.order, whatsappOrder.newStatus);
                }
              }}
            >
              <Phone className="h-4 w-4 mr-2" />
              Enviar WhatsApp
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const isOnlinePayment = order.payment_method === 'pix' || order.payment_method === 'online';
  const isPaid = order.payment_status === 'paid';
  const StatusIcon = statusConfig[order.status].icon;
  
  return (
    <button
      onClick={onClick}
      className="w-full text-left group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30 hover:-translate-y-0.5"
    >
      {/* Status accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${statusConfig[order.status].color}`} />
      
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${statusConfig[order.status].color}/10`}>
            <StatusIcon className={`h-3.5 w-3.5 ${statusConfig[order.status].color.replace('bg-', 'text-').replace('-500', '-600')}`} />
          </div>
          <span className="font-mono text-xs text-muted-foreground font-medium">
            #{order.id.slice(0, 8)}
          </span>
          {/* Source badge */}
          {order.source === 'pos' && (
            <Badge className="text-[9px] px-1.5 py-0 bg-violet-500/90 text-white">PDV</Badge>
          )}
          {order.source === 'table' && (
            <Badge className="text-[9px] px-1.5 py-0 bg-amber-500/90 text-white">Mesa</Badge>
          )}
          {order.source === 'pickup' && (
            <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500/90 text-white">Retirada</Badge>
          )}
          {(!order.source || order.source === 'online') && (
            <Badge className="text-[9px] px-1.5 py-0 bg-sky-500/90 text-white">Online</Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/70">
          {formatDistanceToNow(new Date(order.created_at), {
            addSuffix: true,
            locale: ptBR,
          })}
        </span>
      </div>
      
      {/* Customer name */}
      <p className="font-semibold text-sm truncate mb-3 group-hover:text-primary transition-colors">
        {order.customer_name}
      </p>
      
      {/* Items count and payment badges */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5 font-normal">
          {order.order_items?.length || 0} {(order.order_items?.length || 0) === 1 ? 'item' : 'itens'}
        </Badge>
        <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-normal">
          {paymentMethodLabels[order.payment_method]}
        </Badge>
        {isOnlinePayment && (
          <Badge 
            variant={isPaid ? 'default' : 'secondary'}
            className={`text-[10px] px-2 py-0.5 font-medium ${isPaid ? 'bg-emerald-500/90 text-white border-emerald-500' : 'bg-amber-100 text-amber-700 border-amber-200'}`}
          >
            {isPaid ? '✓ Pago' : '⏳ Aguardando'}
          </Badge>
        )}
      </div>
      
      {/* Price */}
      <div className="flex items-center justify-between pt-2 border-t border-border/50">
        <span className="text-xs text-muted-foreground">Total</span>
        <span className="font-bold text-base text-primary">R$ {Number(order.total).toFixed(2)}</span>
      </div>
    </button>
  );
}

function OrdersList({
  orders,
  onViewOrder,
}: {
  orders: Order[];
  onViewOrder: (order: Order) => void;
}) {
  if (orders.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="p-4 rounded-full bg-muted/50 mb-4">
            <Package className="h-10 w-10 text-muted-foreground/50" />
          </div>
          <p className="text-muted-foreground font-medium">Nenhum pedido encontrado</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Os pedidos aparecerão aqui</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => {
        const StatusIcon = statusConfig[order.status].icon;
        const isOnlinePayment = order.payment_method === 'pix' || order.payment_method === 'online';
        const isPaid = order.payment_status === 'paid';
        
        return (
          <Card 
            key={order.id} 
            className="group hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30 transition-all duration-200 cursor-pointer overflow-hidden" 
            onClick={() => onViewOrder(order)}
          >
            <CardContent className="p-0">
              <div className="flex items-center">
                {/* Status color bar */}
                <div className={`w-1.5 self-stretch ${statusConfig[order.status].color}`} />
                
                <div className="flex-1 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {/* Status icon */}
                    <div className={`p-2.5 rounded-xl ${statusConfig[order.status].color}/10`}>
                      <StatusIcon className={`h-5 w-5 ${statusConfig[order.status].color.replace('bg-', 'text-').replace('-500', '-600')}`} />
                    </div>
                    
                    {/* Order info */}
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-mono text-sm text-muted-foreground">#{order.id.slice(0, 8)}</p>
                        <Badge variant="outline" className="text-[10px]">
                          {getStatusLabel(order.status, order.source)}
                        </Badge>
                        {order.source === 'pos' && (
                          <Badge className="text-[10px] bg-violet-500/90 text-white">
                            PDV
                          </Badge>
                        )}
                        {order.source === 'table' && (
                          <Badge className="text-[10px] bg-amber-500/90 text-white">
                            Mesa
                          </Badge>
                        )}
                        {order.source === 'pickup' && (
                          <Badge className="text-[10px] bg-emerald-500/90 text-white">
                            Retirada
                          </Badge>
                        )}
                        {(!order.source || order.source === 'online') && (
                          <Badge className="text-[10px] bg-sky-500/90 text-white">
                            Online
                          </Badge>
                        )}
                      </div>
                      <p className="font-semibold group-hover:text-primary transition-colors">{order.customer_name}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {paymentMethodLabels[order.payment_method]}
                        </Badge>
                        {isOnlinePayment && (
                          <Badge 
                            className={`text-[10px] ${isPaid ? 'bg-emerald-500/90 text-white' : 'bg-amber-100 text-amber-700'}`}
                          >
                            {isPaid ? '✓ Pago' : 'Aguardando'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Right side */}
                  <div className="text-right">
                    <p className="font-bold text-lg text-primary">R$ {Number(order.total).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(order.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// Payment Methods Indicator Component
function PaymentMethodsIndicator({ orders }: { orders: Order[] }) {
  // Filter only delivered orders for accurate stats
  const deliveredOrders = orders.filter((o) => o.status === 'delivered');
  
  if (deliveredOrders.length === 0) {
    return null;
  }

  const paymentCounts = deliveredOrders.reduce((acc, order) => {
    acc[order.payment_method] = (acc[order.payment_method] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const total = deliveredOrders.length;
  
  const paymentData = Object.entries(paymentCounts)
    .map(([method, count]) => ({
      method: method as PaymentMethod,
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const getPaymentIcon = (method: PaymentMethod) => {
    switch (method) {
      case 'pix':
        return <Smartphone className="h-4 w-4" />;
      case 'cash':
        return <Banknote className="h-4 w-4" />;
      case 'card_on_delivery':
        return <CreditCard className="h-4 w-4" />;
      case 'online':
        return <Wallet className="h-4 w-4" />;
      default:
        return <CreditCard className="h-4 w-4" />;
    }
  };

  const getPaymentColor = (method: PaymentMethod) => {
    switch (method) {
      case 'pix':
        return 'bg-emerald-500';
      case 'cash':
        return 'bg-amber-500';
      case 'card_on_delivery':
        return 'bg-blue-500';
      case 'online':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="py-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            Meios de pagamento mais usados
          </span>
          <Badge variant="secondary" className="ml-auto text-xs">
            {total} pedidos entregues
          </Badge>
        </div>
        
        {/* Progress bar */}
        <div className="flex h-3 rounded-full overflow-hidden bg-muted/50 mb-3">
          {paymentData.map((item) => (
            <div
              key={item.method}
              className={`${getPaymentColor(item.method)} transition-all`}
              style={{ width: `${item.percentage}%` }}
              title={`${paymentMethodLabels[item.method]}: ${item.percentage}%`}
            />
          ))}
        </div>
        
        {/* Legend */}
        <div className="flex flex-wrap gap-4">
          {paymentData.map((item) => (
            <div key={item.method} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getPaymentColor(item.method)}`} />
              <div className="flex items-center gap-1.5 text-sm">
                {getPaymentIcon(item.method)}
                <span className="font-medium">{paymentMethodLabels[item.method]}</span>
                <span className="text-muted-foreground">
                  ({item.count} - {item.percentage}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
