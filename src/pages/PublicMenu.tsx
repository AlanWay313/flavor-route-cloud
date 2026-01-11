import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Clock,
  MapPin,
  Phone,
  ShoppingBag,
  Search,
  Store,
  AlertCircle,
  Package,
  Star,
  Plus,
  Minus,
  ArrowLeft,
  X,
  ChevronRight,
  Flame,
  Check,
  Tag,
  Pizza,
  Moon,
  Sun,
  Home,
  Heart,
  Menu as MenuIcon,
  Share2,
  Bell,
  Ticket,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { OptimizedImage } from '@/components/ui/optimized-image';
import { supabase } from '@/integrations/supabase/client';
import { useCart, CartProvider, CartItem } from '@/hooks/useCart';
import { ProductModal, CartDrawer } from '@/components/menu/ProductModal';
import { CheckoutPage } from '@/components/menu/CheckoutPage';
import { ComboModal } from '@/components/menu/ComboModal';
// import { TrackOrderModal } from '@/components/menu/TrackOrderModal';
import { InstallAppPrompt } from '@/components/InstallAppPrompt';
import { PushNotificationButton } from '@/components/PushNotificationButton';
import { HalfHalfPizzaModal } from '@/components/menu/HalfHalfPizzaModal';
import { WaiterCallButton } from '@/components/tables/WaiterCallButton';
import { CustomerCountModal } from '@/components/tables/CustomerCountModal';
import { MyTicketsModal } from '@/components/menu/MyTicketsModal';
import { usePizzaConfig } from '@/hooks/usePizzaConfig';
import { useSmartSuggestions } from '@/hooks/useSmartSuggestions';
import { useAcaiOptionsCache } from '@/hooks/useAcaiOptionsCache';
import { cn, isLightColor } from '@/lib/utils';
import { checkStoreOpen, formatTodayHours } from '@/lib/storeHours';
import { filterCategoriesByDayPeriod, DayPeriod, CategoryDayPeriod } from '@/lib/dayPeriods';
import { OperatingHours } from '@/components/store/OperatingHoursEditor';
import { Json } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFavorites } from '@/hooks/useFavorites';

interface Company {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  address: string | null;
  city: string | null;
  is_open: boolean;
  delivery_fee: number;
  min_order_value: number;
  primary_color: string | null;
  opening_hours: Json | null;
  niche: string | null;
  menu_published?: boolean | null;
  // Campos sensíveis removidos da view pública:
  // phone, pix_key, pix_key_type, owner_id
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  promotional_price?: number | null;
  image_url: string | null;
  is_active: boolean;
  is_featured: boolean;
  category_id: string | null;
  product_options?: {
    id: string;
    name: string;
    price_modifier: number;
    is_required: boolean;
  }[];
}

interface Promotion {
  id: string;
  name: string;
  description: string | null;
  discount_type: string;
  discount_value: number;
  product_id: string | null;
  category_id: string | null;
  image_url: string | null;
  is_active: boolean;
  expires_at: string | null;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  promotional_price?: number | null;
  image_url: string | null;
  is_active: boolean;
  is_featured: boolean;
  category_id: string | null;
  // Tipo do produto no banco (ex: 'pizza', 'bebida', etc.)
  product_type?: string;
  product_options?: {
    id: string;
    name: string;
    price_modifier: number;
    is_required: boolean;
  }[];
}

function hexToHsl(hex: string): string | null {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return null;
  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  const hh = Math.round(h * 360);
  const ss = Math.round(s * 100);
  const ll = Math.round(l * 100);
  return `${hh} ${ss}% ${ll}%`;
}

function PublicMenuContent() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { setCompanySlug, items, itemCount, subtotal, addItem, updateQuantity, removeItem, clearCart } = useCart();
  const categoriesRef = useRef<HTMLDivElement>(null);
  const hasSyncedThemeRef = useRef(false);

  // Detect if running inside iframe (embedded mode for preview)
  const isEmbedded = searchParams.get('embedded') === '1';

  const [company, setCompany] = useState<Company | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState(false);
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);
  const [cartBounce, setCartBounce] = useState(false);
  const [halfHalfModalOpen, setHalfHalfModalOpen] = useState(false);
  const [unavailableProductIds, setUnavailableProductIds] = useState<string[]>([]);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [hasStoredCustomerEmail, setHasStoredCustomerEmail] = useState(false);
  const [storedCustomerId, setStoredCustomerId] = useState<string | null>(null);
  const [showMyTicketsModal, setShowMyTicketsModal] = useState(false);
  const [lotteryEnabled, setLotteryEnabled] = useState(false);
  const [paymentErrorMessage, setPaymentErrorMessage] = useState<string | null>(null);
  const [dayPeriods, setDayPeriods] = useState<DayPeriod[]>([]);
  const [categoryDayPeriods, setCategoryDayPeriods] = useState<CategoryDayPeriod[]>([]);
  
  // Table order from QR code - using session token for security
  // Skip table session checks when embedded (preview mode)
  const sessionTokenFromUrl = isEmbedded ? null : searchParams.get('sessao');
  const legacyTableFromUrl = isEmbedded ? null : (searchParams.get('mesa') ? parseInt(searchParams.get('mesa')!, 10) : null);
  
  // Referral code from URL
  const referralCodeFromUrl = searchParams.get('ref');
  const [referralCode, setReferralCode] = useState<string | null>(referralCodeFromUrl);
  
  const [sessionToken, setSessionToken] = useState<string | null>(sessionTokenFromUrl);
  const [tableNumber, setTableNumber] = useState<number | null>(legacyTableFromUrl);
  const [tableId, setTableId] = useState<string | null>(null);
  const [tableSessionId, setTableSessionId] = useState<string | null>(null);
  const [tableSessionValid, setTableSessionValid] = useState<boolean | null>(null);
  const [tableSessionError, setTableSessionError] = useState<string | null>(null);
  const [checkingTableSession, setCheckingTableSession] = useState(false);
  const [showCustomerCountModal, setShowCustomerCountModal] = useState(false);
  const [pendingSessionToken, setPendingSessionToken] = useState<string | null>(null);
  
  // Sync session token when URL changes
  // Initialize session token and table number from URL (only once)
  useEffect(() => {
    if (sessionTokenFromUrl && !sessionToken) {
      setSessionToken(sessionTokenFromUrl);
    }
    if (legacyTableFromUrl && !tableNumber) {
      setTableNumber(legacyTableFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount
  
  // Ref para evitar múltiplas verificações de sessão
  const tableSessionCheckRef = useRef<string | null>(null);
  
  // Check if session token is valid
  useEffect(() => {
    // Criar uma chave única para esta verificação
    const checkKey = `${sessionToken || ''}-${tableNumber || ''}-${slug || ''}`;
    
    // Evitar verificação duplicada
    if (tableSessionCheckRef.current === checkKey) return;
    
    const checkTableSession = async () => {
      // Marcar que estamos verificando esta combinação
      tableSessionCheckRef.current = checkKey;
      
      // If using new token-based system
      if (sessionToken) {
        setCheckingTableSession(true);
        try {
          const response = await supabase.functions.invoke('check-table-session', {
            body: { sessionToken }
          });
          
          if (response.error) {
            console.error('Error checking table session:', response.error);
            setTableSessionValid(false);
            setTableSessionError('Erro ao verificar sessão. Tente novamente.');
            return;
          }
          
          const data = response.data;
          if (data.hasActiveSession) {
            setTableSessionValid(true);
            setTableNumber(data.tableNumber);
            setTableId(data.tableId);
            setTableSessionId(data.sessionId);
            setTableSessionError(null);
          } else {
            setTableSessionValid(false);
            setTableSessionError(data.message || 'Sessão não encontrada ou expirada.');
          }
        } catch (error) {
          console.error('Error checking table session:', error);
          setTableSessionValid(false);
          setTableSessionError('Erro ao verificar sessão.');
        } finally {
          setCheckingTableSession(false);
        }
        return;
      }
      
      // Legacy: If using old table number system (for backward compatibility)
      // Check if there's an active session for this table and redirect to token-based URL
      if (tableNumber && !sessionToken && slug) {
        setCheckingTableSession(true);
        try {
          const response = await supabase.functions.invoke('check-table-by-number', {
            body: { tableNumber, companySlug: slug }
          });
          
          if (response.error) {
            console.error('Error checking table by number:', response.error);
            setTableSessionValid(false);
            setTableSessionError('Erro ao verificar mesa.');
            setCheckingTableSession(false);
            return;
          }
          
          const data = response.data;
          if (data.hasActiveSession && data.sessionToken) {
            // Redirect to token-based URL
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('mesa');
            newUrl.searchParams.set('sessao', data.sessionToken);
            window.history.replaceState({}, '', newUrl.toString());
            
            // Atualizar a ref antes de mudar o estado para evitar loop
            tableSessionCheckRef.current = `${data.sessionToken}-${data.tableNumber}-${slug}`;
            
            setSessionToken(data.sessionToken);
            setTableNumber(data.tableNumber);
            setTableSessionError(null);
            
            // If this is a newly created session, show customer count modal
            if (data.newSession) {
              setPendingSessionToken(data.sessionToken);
              setShowCustomerCountModal(true);
              // Don't set tableSessionValid yet - wait for customer count
            } else {
              setTableSessionValid(true);
            }
          } else {
            // No active session - show message
            setTableSessionValid(false);
            setTableSessionError(data.message || 'Mesa não está aberta. Chame o garçom.');
          }
        } catch (error) {
          console.error('Error checking table by number:', error);
          setTableSessionValid(false);
          setTableSessionError('Erro ao verificar mesa.');
        } finally {
          setCheckingTableSession(false);
        }
        return;
      }
      
      // No table/session mode
      setTableSessionValid(null);
      setTableSessionError(null);
    };
    
    checkTableSession();
  }, [sessionToken, tableNumber, slug]);
  
  // Handle customer count confirmation for new table sessions
  const handleCustomerCountConfirm = async (count: number) => {
    if (!pendingSessionToken) return;
    
    try {
      await supabase.functions.invoke('update-session-customer-count', {
        body: { sessionToken: pendingSessionToken, customerCount: count }
      });
      
      setTableSessionValid(true);
      setShowCustomerCountModal(false);
      setPendingSessionToken(null);
      toast.success(`Mesa aberta com ${count} ${count === 1 ? 'pessoa' : 'pessoas'}!`);
    } catch (error) {
      console.error('Error updating customer count:', error);
      // Still allow access even if count update fails
      setTableSessionValid(true);
      setShowCustomerCountModal(false);
      setPendingSessionToken(null);
    }
  };
  
  // Clear table mode and remove from URL
  const clearTableMode = () => {
    if (isEmbedded) return; // Don't modify URL in embedded mode
    setSessionToken(null);
    setTableNumber(null);
    setTableId(null);
    setTableSessionId(null);
    setTableSessionValid(null);
    setTableSessionError(null);
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('sessao');
    newUrl.searchParams.delete('mesa');
    window.history.replaceState({}, '', newUrl.toString());
  };
  
  // Combo state
  const [comboProductIds, setComboProductIds] = useState<Set<string>>(new Set());
  const [selectableComboProductIds, setSelectableComboProductIds] = useState<Set<string>>(new Set());
  const [selectedCombo, setSelectedCombo] = useState<Product | null>(null);

  // Handle payment return from Mercado Pago - skip in embedded mode
  useEffect(() => {
    if (isEmbedded) return; // Don't handle payment redirects in embedded mode
    
    const paymentStatus = searchParams.get('payment');
    if (paymentStatus === 'failure' || paymentStatus === 'cancelled') {
      setCheckoutMode(true);
      setPaymentErrorMessage(
        paymentStatus === 'cancelled'
          ? 'Pagamento cancelado. Escolha outra forma de pagamento ou tente novamente.'
          : 'Pagamento não aprovado. Escolha outra forma de pagamento ou tente novamente.'
      );
      // Remove payment params from URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('payment');
      newUrl.searchParams.delete('pending_id');
      window.history.replaceState({}, '', newUrl.toString());
    } else if (paymentStatus === 'success') {
      // Limpar params da URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('payment');
      newUrl.searchParams.delete('pending_id');
      window.history.replaceState({}, '', newUrl.toString());

      // Pagamento aprovado: agora sim limpamos o carrinho
      clearCart();
      toast.success('Pagamento aprovado! Seu pedido foi confirmado.');
    }
  }, [searchParams, clearCart, isEmbedded]);
  
  // Payment info (fetched securely when entering checkout)
  const [paymentInfo, setPaymentInfo] = useState<{
    phone: string | null;
    pixKey: string | null;
    pixKeyType: string | null;
    onlinePaymentEnabled: boolean;
    pixEnabled: boolean;
    cardEnabled: boolean;
    activeGateway: 'mercadopago' | 'picpay';
    showPixKeyOnMenu: boolean;
  } | null>(null);
  const [loadingPaymentInfo, setLoadingPaymentInfo] = useState(false);

  const isPreview = searchParams.get('preview') === '1';

  const isMobile = useIsMobile();

  // Tema do cardápio, sincronizado com next-themes e salvo em localStorage
  const [isMenuDark, setIsMenuDark] = useState<boolean>(false);

  // Sincroniza o tema salvo do cardápio com o next-themes apenas uma vez
  useEffect(() => {
    if (hasSyncedThemeRef.current) return;
    if (typeof window === 'undefined') return;

    const stored = window.localStorage.getItem('public-menu-theme');
    if (stored === 'dark' || stored === 'light') {
      const isDark = stored === 'dark';
      setIsMenuDark(isDark);
      setTheme(isDark ? 'dark' : 'light');
    } else {
      const isDark = theme === 'dark';
      setIsMenuDark(isDark);
      window.localStorage.setItem('public-menu-theme', isDark ? 'dark' : 'light');
    }

    hasSyncedThemeRef.current = true;
  }, [theme, setTheme]);

  // Pizza config
  const pizzaConfig = usePizzaConfig(company?.id || null);
  const { favoriteProductIds, toggleFavorite } = useFavorites(company?.id || null);
  
  // Cache de opções de açaí para evitar delay no modal
  const acaiCache = useAcaiOptionsCache();

  // SEO / Open Graph meta tags para compartilhamento do cardápio
  useEffect(() => {
    if (!company) return;
    if (typeof document === 'undefined') return;

    const title = `${company.name} | Cardápio online`;
    const description =
      company.description && company.description.trim().length > 0
        ? company.description.trim()
        : `Peça online na ${company.name} com praticidade e rapidez.`;

    const baseImage = company.logo_url || company.cover_url || '/favicon.png';
    const imageUrl =
      typeof window !== 'undefined' && baseImage?.startsWith('/')
        ? `${window.location.origin}${baseImage}`
        : baseImage;

    const url = typeof window !== 'undefined' ? window.location.href : undefined;

    const upsertMeta = (selector: string, attrs: Record<string, string>) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement('meta');
        Object.entries(attrs).forEach(([key, value]) => el!.setAttribute(key, value));
        document.head.appendChild(el);
      } else if (attrs.content) {
        el.setAttribute('content', attrs.content);
      }
    };

    document.title = title;

    upsertMeta('meta[name="description"]', { name: 'description', content: description });

    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
    if (imageUrl) {
      upsertMeta('meta[property="og:image"]', { property: 'og:image', content: imageUrl });
      upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: imageUrl });
    }
    if (url) {
      upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url });
      const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]') ??
        (() => {
          const link = document.createElement('link');
          link.setAttribute('rel', 'canonical');
          document.head.appendChild(link);
          return link;
        })();
      canonical.setAttribute('href', url);
    }
  }, [company]);

  // Ref para evitar carregamento duplicado e loops infinitos
  const loadedSlugRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  
  useEffect(() => {
    // Verificações rigorosas para evitar recarregamento em loop
    if (!slug) return;
    if (slug === loadedSlugRef.current) return;
    if (isLoadingRef.current) return;
    
    loadedSlugRef.current = slug;
    isLoadingRef.current = true;
    setCompanySlug(slug);
    
    loadCompanyData().finally(() => {
      isLoadingRef.current = false;
    });
  }, [slug]);

  // Check if customer has stored email and customer ID
  useEffect(() => {
    if (!company?.id) return;
    try {
      const key = `menupro_customer_${company.id}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.email) {
          setHasStoredCustomerEmail(true);
          if (parsed?.id) {
            setStoredCustomerId(parsed.id);
          }
          return;
        }
      }
      // Fallback para localStorage legado
      const legacy = localStorage.getItem('menupro_customer');
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (parsed?.email) {
          setHasStoredCustomerEmail(true);
          if (parsed?.id) {
            setStoredCustomerId(parsed.id);
          }
          return;
        }
      }
      setHasStoredCustomerEmail(false);
      setStoredCustomerId(null);
    } catch {
      setHasStoredCustomerEmail(false);
      setStoredCustomerId(null);
    }
  }, [company?.id]);

  // Check if lottery is enabled for this company
  useEffect(() => {
    if (!company?.id) return;
    const checkLottery = async () => {
      try {
        const { data, error } = await supabase
          .from('lottery_settings')
          .select('is_enabled')
          .eq('company_id', company.id)
          .eq('is_enabled', true)
          .maybeSingle();
        
        if (!error && data) {
          setLotteryEnabled(true);
        } else {
          setLotteryEnabled(false);
        }
      } catch {
        setLotteryEnabled(false);
      }
    };
    checkLottery();
  }, [company?.id]);

  const loadCompanyData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use companies_public view to avoid leaking sensitive data like owner_id, email, stripe_customer_id
      const { data: companyData, error: companyError } = await supabase
        .from('companies_public')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      if (companyError) throw companyError;
      if (!companyData) {
        setError('Empresa não encontrada');
        setLoading(false);
        return;
      }

      // Bloquear acesso se o cardápio não estiver publicado (exceto em preview)
      if (companyData.menu_published === false && !isPreview) {
        setError('Cardápio indisponível no momento. O estabelecimento está com o cardápio temporariamente desativado.');
        setLoading(false);
        return;
      }

      setCompany(companyData);

      const { data: categoriesData, error: categoriesError } = await supabase
        .from('categories')
        .select('*')
        .eq('company_id', companyData.id)
        .eq('is_active', true)
        .order('sort_order');

      if (categoriesError) throw categoriesError;
      setCategories(categoriesData || []);

      const [productsRes, promotionsRes] = await Promise.all([
        supabase
          .from('products')
          .select(`*, product_options (*)`)
          .eq('company_id', companyData.id)
          .eq('is_active', true),
        supabase
          .from('promotions')
          .select('*')
          .eq('company_id', companyData.id)
          .eq('is_active', true),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (promotionsRes.error) throw promotionsRes.error;

      setProducts(productsRes.data || []);
      setPromotions(promotionsRes.data || []);

      // Buscar combos para identificar quais produtos são combos
      const { data: combosData } = await supabase
        .from('combos')
        .select('product_id, combo_mode')
        .eq('company_id', companyData.id);
      
      setComboProductIds(new Set((combosData || []).map(c => c.product_id)));
      setSelectableComboProductIds(new Set(
        (combosData || [])
          .filter(c => c.combo_mode === 'selectable')
          .map(c => c.product_id)
      ));

      // Buscar períodos do dia e suas categorias
      const [periodsRes, categoryPeriodsRes] = await Promise.all([
        supabase
          .from('day_periods')
          .select('id, name, start_time, end_time, is_active')
          .eq('company_id', companyData.id),
        supabase
          .from('category_day_periods')
          .select('category_id, day_period_id'),
      ]);

      if (!periodsRes.error) {
        setDayPeriods(periodsRes.data || []);
      }
      if (!categoryPeriodsRes.error) {
        setCategoryDayPeriods(categoryPeriodsRes.data || []);
      }

      // Buscar produtos indisponíveis com base no estoque de ingredientes
      const { data: availabilityData, error: availabilityError } = await supabase.functions.invoke('get-unavailable-products', {
        body: { companyId: companyData.id },
      });

      if (!availabilityError && availabilityData?.ok) {
        setUnavailableProductIds(availabilityData.unavailableProductIds || []);
      }
    } catch (err: any) {
      console.error('Error loading menu:', err);
      setError(err.message || 'Erro ao carregar cardápio');
    } finally {
      setLoading(false);
    }
  };

  // Get quantity of product in cart
  const getProductQuantityInCart = (productId: string): number => {
    return items
      .filter(item => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
  };

  // Ação rápida do botão +: apenas abrir o produto para configurar
  const handleQuickAdd = (product: Product, e: React.MouseEvent) => {
    e.stopPropagation();

    const isUnavailable = unavailableProductIds.includes(product.id);
    if (isUnavailable) {
      toast.error('Produto indisponível no estoque no momento.');
      return;
    }

    // Se for combo, abrir ComboModal
    if (comboProductIds.has(product.id)) {
      setSelectedCombo(product);
      return;
    }

    // Sempre abrir o produto para configuração, não adicionar direto
    setSelectedProduct(product);
  };

  // Clique no card do produto
  const handleProductClick = (product: Product) => {
    // Se for combo, abrir ComboModal
    if (comboProductIds.has(product.id)) {
      setSelectedCombo(product);
      return;
    }
    setSelectedProduct(product);
  };

  const handleToggleFavoriteClick = (productId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(productId);
  };
  // Filtrar categorias baseado nos períodos do dia
  const visibleCategoryIds = filterCategoriesByDayPeriod(
    categories.map((c) => c.id),
    dayPeriods,
    categoryDayPeriods
  );
  const visibleCategories = categories.filter((c) => visibleCategoryIds.includes(c.id));

  const baseFilteredProducts = products.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.description?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = !selectedCategory || product.category_id === selectedCategory;
    // Só mostra produtos de categorias visíveis
    const categoryVisible = product.category_id ? visibleCategoryIds.includes(product.category_id) : true;
    return matchesSearch && matchesCategory && categoryVisible;
  });

  const filteredProducts = showOnlyFavorites
    ? baseFilteredProducts.filter((p) => favoriteProductIds.includes(p.id))
    : baseFilteredProducts;

  const featuredProducts = products.filter((p) => p.is_featured);

  const openingHours = company?.opening_hours as unknown as OperatingHours | null;
  const storeStatus = company ? checkStoreOpen(company.is_open, openingHours) : null;
  const isActuallyOpen = storeStatus?.isOpen ?? false;
  const todayHours = company ? formatTodayHours(openingHours) : null;

  // Update favicon to store logo while on public menu
  useEffect(() => {
    const defaultFavicons = Array.from(document.querySelectorAll("link[rel='icon']"));
    const defaultHrefs = defaultFavicons.map((link) => (link as HTMLLinkElement).href);

    if (company?.logo_url) {
      defaultFavicons.forEach((linkEl) => {
        (linkEl as HTMLLinkElement).href = company.logo_url!;
      });
    }

    return () => {
      // Restore default favicon when leaving the menu
      defaultFavicons.forEach((linkEl, index) => {
        (linkEl as HTMLLinkElement).href = defaultHrefs[index] || '/favicon.png';
      });
    };
  }, [company?.logo_url]);
  
  // Smart AI-powered suggestions based on cart contents
  const { suggestions: smartSuggestions } = useSmartSuggestions(
    items.map(item => ({ productId: item.productId, productName: item.productName })),
    products.map(p => ({ 
      id: p.id, 
      name: p.name, 
      price: Number(p.price), 
      image_url: p.image_url, 
      category_id: p.category_id 
    })),
    categories.map(c => ({ id: c.id, name: c.name })),
    dayPeriods,
    categoryDayPeriods,
    items.length > 0 // Only enable when cart has items
  );

  // IDs de produtos que NÃO podem ser usados em meio a meio (config por produto)
  const [halfHalfDisabledProductIds, setHalfHalfDisabledProductIds] = useState<string[]>([]);

  // Mapa category_id -> preço base do tamanho "Grande" (ou primeiro tamanho)
  const [pizzaCategoryBasePrices, setPizzaCategoryBasePrices] = useState<Record<string, number>>({});

  // Açaí categories e preços base
  const [acaiCategoryIds, setAcaiCategoryIds] = useState<string[]>([]);
  const [acaiCategoryBasePrices, setAcaiCategoryBasePrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const loadHalfHalfEligibility = async () => {
      try {
        if (!pizzaConfig.pizzaCategoryIds.length || !products.length) {
          setHalfHalfDisabledProductIds([]);
          return;
        }

        const pizzaCategoryProducts = products.filter(
          (p) => p.category_id && pizzaConfig.pizzaCategoryIds.includes(p.category_id)
        );

        if (!pizzaCategoryProducts.length) {
          setHalfHalfDisabledProductIds([]);
          return;
        }

        const { data, error } = await supabase
          .from('pizza_product_settings')
          .select('product_id, allow_half_half')
          .in('product_id', pizzaCategoryProducts.map((p) => p.id));

        if (error) {
          console.error('Erro ao carregar configurações de meio a meio por produto:', error);
          return;
        }

        const disabledIds = (data || [])
          .filter((row: any) => row.allow_half_half === false)
          .map((row: any) => row.product_id as string);

        setHalfHalfDisabledProductIds(disabledIds);
      } catch (err) {
        console.error('Erro inesperado ao carregar elegibilidade de meio a meio:', err);
      }
    };

    loadHalfHalfEligibility();
  }, [pizzaConfig.pizzaCategoryIds, products]);

  // Carregar preço base (tamanho Grande) por categoria de pizza, usando as categorias da loja
  useEffect(() => {
    const loadPizzaBasePrices = async () => {
      try {
        if (!company?.id || !categories.length) {
          setPizzaCategoryBasePrices({});
          return;
        }

        const categoryIds = categories.map((c) => c.id);

        const { data, error } = await supabase
          .from('pizza_category_sizes')
          .select('category_id, name, base_price')
          .in('category_id', categoryIds);

        if (error) {
          console.error('Erro ao carregar tamanhos de pizza:', error);
          return;
        }

        const map: Record<string, number> = {};

        categoryIds.forEach((catId) => {
          const sizesForCategory = (data || []).filter((row: any) => row.category_id === catId);
          if (!sizesForCategory.length) return;

          const grande = sizesForCategory.find((s: any) =>
            String(s.name || '').toLowerCase().includes('grande')
          );
          const chosen = grande || sizesForCategory[0];
          const basePrice = Number(chosen.base_price || 0);
          if (basePrice > 0) {
            map[catId] = basePrice;
          }
        });

        setPizzaCategoryBasePrices(map);
      } catch (err) {
        console.error('Erro inesperado ao carregar preços base de pizza:', err);
      }
    };

    loadPizzaBasePrices();
  }, [company?.id, categories]);

  // Carregar categorias e preços base de açaí
  useEffect(() => {
    const loadAcaiData = async () => {
      try {
        if (!company?.id) {
          setAcaiCategoryIds([]);
          setAcaiCategoryBasePrices({});
          return;
        }

        // Buscar categorias de açaí
        const { data: acaiCats, error: acaiCatsError } = await supabase
          .from('acai_categories')
          .select('category_id')
          .eq('company_id', company.id);

        if (acaiCatsError) {
          console.error('Erro ao carregar categorias de açaí:', acaiCatsError);
          return;
        }

        const catIds = (acaiCats || []).map((ac: any) => ac.category_id);
        setAcaiCategoryIds(catIds);

        if (!catIds.length) {
          setAcaiCategoryBasePrices({});
          return;
        }

        // Buscar tamanhos de açaí
        const { data: sizesData, error: sizesError } = await supabase
          .from('acai_category_sizes')
          .select('category_id, name, base_price')
          .in('category_id', catIds);

        if (sizesError) {
          console.error('Erro ao carregar tamanhos de açaí:', sizesError);
          return;
        }

        const map: Record<string, number> = {};

        catIds.forEach((catId) => {
          const sizesForCategory = (sizesData || []).filter((row: any) => row.category_id === catId);
          if (!sizesForCategory.length) return;

          // Ordenar por base_price descrescente para pegar o maior
          const sorted = [...sizesForCategory].sort(
            (a: any, b: any) => Number(b.base_price || 0) - Number(a.base_price || 0)
          );
          const largest = sorted[0];
          const basePrice = Number(largest.base_price || 0);
          if (basePrice > 0) {
            map[catId] = basePrice;
          }
        });

        setAcaiCategoryBasePrices(map);

        // Pré-carregar opções de açaí em cache para não ter delay no modal
        if (catIds.length > 0) {
          acaiCache.preloadAcaiOptions(catIds);
        }
      } catch (err) {
        console.error('Erro inesperado ao carregar dados de açaí:', err);
      }
    };

    loadAcaiData();
  }, [company?.id]);

  // Pizza products for half-half (respeita flag por produto)
  const rawPizzaProducts = pizzaConfig.pizzaCategoryIds.length > 0
    ? products.filter(
        (p) =>
          p.category_id &&
          pizzaConfig.pizzaCategoryIds.includes(p.category_id) &&
          !halfHalfDisabledProductIds.includes(p.id)
      )
    : [];

  const getDisplayPrice = (product: Product) => {
    // Priorizar sempre o preço definido no próprio produto
    if (Number(product.price) > 0) {
      return Number(product.price);
    }
    // Se o produto não tiver preço (0), usar o preço base da categoria (pizza ou açaí)
    if (product.category_id) {
      if (pizzaCategoryBasePrices[product.category_id]) {
        return pizzaCategoryBasePrices[product.category_id];
      }
      if (acaiCategoryBasePrices[product.category_id]) {
        return acaiCategoryBasePrices[product.category_id];
      }
    }
    return 0;
  };

  const pizzaProducts = rawPizzaProducts.map((p) => ({
    ...p,
    price: getDisplayPrice(p),
  }));
  const canShowHalfHalf = pizzaProducts.length >= 2;

  const scrollToCategory = (categoryId: string | null) => {
    setSelectedCategory(categoryId);
    if (categoryId) {
      const element = document.getElementById(`category-${categoryId}`);
      if (element) {
        const headerOffset = 180;
        const elementPosition = element.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Share menu with proper meta tags for social media
  const handleShare = async () => {
    if (!company) return;

    const origin = window.location.origin;

    // Subdomínio dedicado para share (Cloudflare Worker → edge function com OG tags)
    const shareUrl = `https://s.cardpondelivery.com/${company.slug}`;



    const shareTitle = `${company.name} | Cardápio Online`;
    const shareText = company.description?.trim() || `Peça online na ${company.name} com praticidade e rapidez.`;

    // Try native share API first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch (err) {
        // User cancelled or share failed, fall back to clipboard
        if ((err as Error).name !== 'AbortError') {
          console.log('Share failed, falling back to clipboard');
        }
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copiado! Compartilhe com seus clientes.');
    } catch (err) {
      toast.error('Não foi possível copiar o link');
    }
  };

  useEffect(() => {
    if (checkoutMode && company?.id && !paymentInfo && !loadingPaymentInfo) {
      setLoadingPaymentInfo(true);
      supabase.functions.invoke('get-company-payment-info', {
        body: { companyId: company.id }
      }).then(({ data, error }) => {
        if (!error && data) {
          setPaymentInfo({
            phone: data.phone || null,
            pixKey: data.pixKey || null,
            pixKeyType: data.pixKeyType || null,
            onlinePaymentEnabled: !!data.onlinePaymentEnabled,
            pixEnabled: data.pixEnabled !== false,
            cardEnabled: data.cardEnabled !== false,
            activeGateway: data.activeGateway || 'mercadopago',
            showPixKeyOnMenu: !!data.showPixKeyOnMenu,
          });
        }
        setLoadingPaymentInfo(false);
      }).catch(() => {
        setLoadingPaymentInfo(false);
      });
    }
  }, [checkoutMode, company?.id, paymentInfo, loadingPaymentInfo]);

  if (loading) {
    return <MenuSkeleton />;
  }

  const isPreviewMode = isPreview;
  const isMenuPublished = !!company?.menu_published;

  if ((error || !company) && !isPreviewMode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="h-10 w-10 text-destructive" />
          </div>
          <h1 className="text-2xl font-display font-bold mb-2">Ops!</h1>
          <p className="text-muted-foreground mb-8">{error || 'Empresa não encontrada'}</p>
          <Button asChild size="lg" className="h-12 px-8">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar ao início
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!isMenuPublished && !isPreviewMode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
            <Store className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold mb-2">Cardápio em preparação</h1>
          <p className="text-muted-foreground mb-8">
            Este cardápio ainda não foi publicado. Volte mais tarde para conferir as novidades.
          </p>
          <Button asChild size="lg" variant="outline" className="h-12 px-8">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar ao início
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (checkoutMode) {
    return (
      <>
        {paymentErrorMessage && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-destructive text-destructive-foreground p-4 text-center shadow-lg">
            <div className="container flex items-center justify-center gap-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm font-medium">{paymentErrorMessage}</span>
              <button 
                onClick={() => setPaymentErrorMessage(null)} 
                className="ml-4 p-1 hover:bg-destructive-foreground/10 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        <div className={paymentErrorMessage ? 'pt-14' : ''}>
          <CheckoutPage
            companyId={company.id}
            companyName={company.name}
            companySlug={company.slug}
            companyPhone={paymentInfo?.phone || null}
            deliveryFee={Number(company.delivery_fee) || 0}
            minOrderValue={Number(company.min_order_value) || 0}
            onBack={() => {
              setCheckoutMode(false);
              setPaymentErrorMessage(null);
              setPaymentInfo(null);
            }}
            isStoreOpen={isActuallyOpen}
            onlinePaymentEnabled={paymentInfo?.onlinePaymentEnabled || false}
            pixEnabled={paymentInfo?.pixEnabled !== false}
            cardEnabled={paymentInfo?.cardEnabled !== false}
            activeGateway={paymentInfo?.activeGateway || 'mercadopago'}
            showPixKeyOnMenu={paymentInfo?.showPixKeyOnMenu || false}
            manualPixKey={paymentInfo?.pixKey || null}
            manualPixKeyType={paymentInfo?.pixKeyType || null}
            tableNumber={tableNumber}
            tableSessionId={tableSessionId}
            referralCode={referralCode}
          />
        </div>
      </>
    );
  }

  return (
    <div 
      className="min-h-screen bg-background pb-32"
      style={(() => {
        const primaryHsl = company.primary_color ? hexToHsl(company.primary_color) : null;
        const secondaryHsl = (company as any).secondary_color ? hexToHsl((company as any).secondary_color) : null;
        return {
          ...(primaryHsl ? { '--primary': primaryHsl } : {}),
          ...(secondaryHsl ? { '--secondary': secondaryHsl } : {}),
        } as React.CSSProperties;
      })()}
    >
      {/* Restaurant Header with Cover & Logo */}
      <div className="relative">
        {/* Full-bleed cover image */}
        <div className="relative h-44 sm:h-52 w-full overflow-hidden bg-gradient-to-br from-primary/25 to-secondary/60">
          {company.cover_url ? (
            <OptimizedImage
              src={company.cover_url}
              alt={`Capa de ${company.name}`}
              className="w-full h-full object-cover"
              containerClassName="w-full h-full"
              fallback={<div className="w-full h-full gradient-primary opacity-80" />}
            />
          ) : (
            <div className="w-full h-full gradient-primary opacity-80" />
          )}

          {/* Soft bottom fade to background */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />

          {/* Back button removido para não voltar para rota raiz */}

          {/* Share, My Tickets & My Orders (compact) */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {/* My Tickets Button - only show if customer is logged in and lottery is enabled */}
            {storedCustomerId && lotteryEnabled && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowMyTicketsModal(true)}
                className="h-9 w-9 rounded-full bg-amber-500/90 backdrop-blur-sm shadow-md hover:bg-amber-600 text-white"
                title="Meus Tickets"
              >
                <Ticket className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleShare}
              className="h-9 w-9 rounded-full bg-background/90 backdrop-blur-sm shadow-md hover:bg-background"
              title="Compartilhar"
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-9 w-9 rounded-full bg-background/90 backdrop-blur-sm shadow-md hover:bg-background"
            >
              <Link to={`/my-orders?company=${company.slug}`}>
                <ShoppingBag className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Compact restaurant info card */}
        <div className="relative -mt-8 px-4 pb-2">
          <div className="rounded-3xl bg-card border border-border/80 shadow-lg px-4 py-3 flex gap-3 items-center">
            {/* Logo */}
            <div className="flex-shrink-0 -mt-6">
              {company.logo_url ? (
                <OptimizedImage
                  src={company.logo_url}
                  alt={company.name}
                  className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl object-cover border-4 border-card shadow-md"
                  containerClassName="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl overflow-hidden"
                  fallback={
                    <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl gradient-primary flex items-center justify-center border-4 border-card shadow-md">
                      <Store className="h-7 w-7 text-primary-foreground" />
                    </div>
                  }
                />
              ) : (
                <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl gradient-primary flex items-center justify-center border-4 border-card shadow-md">
                  <Store className="h-7 w-7 text-primary-foreground" />
                </div>
              )}
            </div>

            {/* Text info + theme toggle */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="font-display font-bold text-base sm:text-lg truncate">
                    {company.name}
                  </h1>
                  {company.niche && (
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                      {company.niche}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setIsMenuDark((prev) => {
                      const next = !prev;
                      const nextTheme = next ? "dark" : "light";
                      setTheme(nextTheme);
                      if (typeof window !== "undefined") {
                        window.localStorage.setItem("public-menu-theme", nextTheme);
                      }
                      return next;
                    })
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-card backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label={isMenuDark ? "Ativar tema claro do cardápio" : "Ativar tema escuro do cardápio"}
                >
                  <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mt-1">
                <Badge
                  variant="secondary"
                  className={cn(
                    "h-5 px-2 flex items-center gap-1 rounded-full text-[11px]",
                    isActuallyOpen ? "badge-open" : "badge-closed",
                    company.primary_color && !isLightColor(company.primary_color) && "text-white/90"
                  )}
                >
                  <span className={cn(
                    "inline-flex h-1.5 w-1.5 rounded-full",
                    isActuallyOpen ? "bg-emerald-400" : "bg-red-400"
                  )} />
                  {isActuallyOpen ? "Aberto agora" : "Fechado"}
                </Badge>

                {todayHours && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {todayHours}
                  </span>
                )}

                {company.delivery_fee !== null && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Entrega a partir de R$ {Number(company.delivery_fee).toFixed(2)}
                  </span>
                )}
              </div>

              {(company.address || company.city) && (
                <p className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3" />
                  <span>
                    {company.address && `${company.address}`} {company.city && `- ${company.city}`}
                  </span>
                </p>
              )}

              {isPreviewMode && (
                <div className="mt-1">
                  <Badge
                    variant="outline"
                    className="h-5 text-[10px] px-2 border-warning text-warning-foreground bg-warning/10"
                  >
                    Modo pré-visualização — não compartilhe este link com clientes
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Install App - compact and minimal */}
          <div className="mt-3 flex items-center justify-end gap-3 text-xs text-muted-foreground">
            <div className="flex-1 min-w-0">
              <InstallAppPrompt
                name={company?.name ? `${company.name} 2d Cardápio` : "Cardápio Digital"}
                short_name={company?.name || "Cardápio"}
                description={company?.description || `Cardápio digital de ${company?.name || "nossa loja"}`}
                scope={`/cardapio/${slug}`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Search & Categories (escondido quando um modal está aberto) */}
      {!checkoutMode && !cartOpen && !selectedProduct && !halfHalfModalOpen && (
        <div className="sticky top-0 z-30">
          <div className="bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-lg">
            {/* Search - sempre visível para o cliente pesquisar produtos */}
            <div className="px-4 pt-3 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/70" />
                <Input
                  placeholder="O que você quer pedir?"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-11 rounded-full bg-card text-foreground placeholder:text-muted-foreground/70 border-none shadow-card"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground active:scale-95"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Categories - Horizontal Scroll */}
            {categories.length > 0 && (
              <div
                ref={categoriesRef}
                className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide"
              >
                <button
                  onClick={() => scrollToCategory(null)}
                  className={cn(
                    "category-pill whitespace-nowrap flex-shrink-0",
                    selectedCategory === null && "active",
                  )}
                >
                  Todos
                </button>
                {visibleCategories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => scrollToCategory(category.id)}
                    className={cn(
                      "category-pill whitespace-nowrap flex-shrink-0",
                      selectedCategory === category.id && "active",
                    )}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table Order Banner - Shows when customer accessed via QR code */}
      {(tableNumber || sessionToken) && !checkoutMode && (
        <div className="mx-4 mt-4">
          {/* Loading state */}
          {checkingTableSession && (
            <div className="p-3 rounded-xl bg-muted/50 border border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 animate-pulse">
                <span className="text-xl">🍽️</span>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Verificando sessão...
                </p>
              </div>
            </div>
          )}
          
          {/* Session not valid - Table not open */}
          {!checkingTableSession && tableSessionValid === false && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">
                    {tableNumber ? `Mesa ${tableNumber} não está aberta` : 'Sessão inválida'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tableSessionError || 'Essa sessão já foi encerrada. Peça ao garçom para abrir uma nova.'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => {
                    // Clear current session and reload to try scanning again
                    sessionStorage.removeItem('tableSessionToken');
                    window.location.reload();
                  }}
                >
                  Reescanear QR Code
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={clearTableMode}
                >
                  Fazer delivery
                </Button>
              </div>
            </div>
          )}
          
          {/* Session valid - Table is open */}
          {!checkingTableSession && tableSessionValid === true && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                      Pedido para Mesa {tableNumber}
                    </p>
                    <p className="text-xs text-muted-foreground">Consumo no local</p>
                  </div>
                </div>
                <button
                  onClick={clearTableMode}
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
                >
                  Quero entrega
                </button>
              </div>
              
              {/* Waiter Call Button */}
              {company && tableId && tableSessionId && (
                <WaiterCallButton
                  companyId={company.id}
                  tableId={tableId}
                  tableSessionId={tableSessionId}
                  tableNumber={tableNumber || 0}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Closed Store Warning */}
      {!isActuallyOpen && (
        <div className="mx-4 mt-4">
          <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/10 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-medium text-destructive">
                {storeStatus?.reason === 'manual_closed' && 'Loja fechada no momento'}
                {storeStatus?.reason === 'day_closed' && 'Não abrimos hoje'}
                {storeStatus?.reason === 'outside_hours' && 'Fora do horário'}
              </p>
              {storeStatus?.nextOpenTime && (
                <p className="text-xs text-muted-foreground">{storeStatus.nextOpenTime}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Promotions Banner - Horizontal Scroll */}
      {promotions.length > 0 && !searchQuery && !selectedCategory && (
        <div className="mt-6">
          <div className="flex items-center gap-2 px-4 mb-3">
            <Tag className="h-5 w-5 text-primary" />
            <h2 className="text-base font-display font-bold">Promoções</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide">
            {promotions.map((promo) => (
              <div 
                key={promo.id}
                className="flex-shrink-0 w-72 p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/10 border border-primary/20"
              >
                <div className="flex gap-3">
                  {promo.image_url ? (
                    <OptimizedImage
                      src={promo.image_url}
                      alt={promo.name}
                      className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                      containerClassName="w-16 h-16 rounded-xl flex-shrink-0"
                      fallback={
                        <div className="w-16 h-16 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <Tag className="h-6 w-6 text-primary" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <Tag className="h-6 w-6 text-primary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <Badge className="mb-1.5 bg-primary/90 text-primary-foreground">
                      {promo.discount_type === 'percentage' 
                        ? `${promo.discount_value}% OFF` 
                        : `R$ ${Number(promo.discount_value).toFixed(2)} OFF`}
                    </Badge>
                    <h3 className="font-semibold text-sm truncate">{promo.name}</h3>
                    {promo.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{promo.description}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Featured Products - Horizontal Scroll */}
      {featuredProducts.length > 0 && !searchQuery && !selectedCategory && (
        <div className="mt-6">
          <div className="flex items-center gap-2 px-4 mb-3">
            <Flame className="h-5 w-5 text-primary" />
            <h2 className="text-base font-display font-bold">Mais pedidos</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide">
            {featuredProducts.map((product) => {
              const displayPrice = getDisplayPrice(product);
              return (
                <FeaturedProductCard
                  key={product.id}
                  product={{ ...product, price: displayPrice }}
                  onClick={() => handleProductClick(product)}
                  onQuickAdd={(e) => handleQuickAdd(product, e)}
                  quantityInCart={getProductQuantityInCart(product.id)}
                  isRecentlyAdded={recentlyAddedId === product.id}
                  isFavorite={favoriteProductIds.includes(product.id)}
                  onToggleFavorite={(e) => handleToggleFavoriteClick(product.id, e)}
                  isCombo={comboProductIds.has(product.id)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Half-Half Pizza CTA */}
      {canShowHalfHalf && (
        <div className="mt-6 px-4">
          <button
            onClick={() => setHalfHalfModalOpen(true)}
            className="w-full p-6 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-secondary/10 border-2 border-primary/20 hover:border-primary/40 transition-all active:scale-[0.98] group"
          >
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                <Pizza className="h-8 w-8 text-primary" />
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-display font-bold text-lg mb-1">
                  🍕 Monte sua Pizza Meio a Meio
                </h3>
                <p className="text-sm text-muted-foreground">
                  Escolha até {pizzaConfig.settings?.max_flavors} sabores • Preço do sabor mais caro
                </p>
              </div>
              <ChevronRight className="h-6 w-6 text-primary flex-shrink-0 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
        </div>
      )}

      {/* Products by Category */}
      {visibleCategories.map((category) => {
        const categoryProducts = filteredProducts.filter(
          (p) => p.category_id === category.id
        );
        if (categoryProducts.length === 0) return null;

        return (
          <div key={category.id} id={`category-${category.id}`} className="mt-6">
            <h2 className="text-base font-display font-bold px-4 mb-3">{category.name}</h2>
            <div className="space-y-3 px-4">
               {categoryProducts.map((product) => {
                 const displayPrice = getDisplayPrice(product);
                 const isCombo = comboProductIds.has(product.id);
                 const isSelectableCombo = selectableComboProductIds.has(product.id);
                 const isAcaiProduct = !!product.category_id && acaiCategoryIds.includes(product.category_id);
                 return (
                   <ProductCard
                     key={product.id}
                     product={{ ...product, price: displayPrice }}
                     onClick={() => handleProductClick(product)}
                     onQuickAdd={(e) => handleQuickAdd(product, e)}
                     quantityInCart={getProductQuantityInCart(product.id)}
                     isRecentlyAdded={recentlyAddedId === product.id}
                     isFavorite={favoriteProductIds.includes(product.id)}
                     onToggleFavorite={(e) => handleToggleFavoriteClick(product.id, e)}
                     isCombo={isCombo}
                     isSelectableCombo={isSelectableCombo}
                     isAcaiProduct={isAcaiProduct}
                   />
                 );
               })}
             </div>
           </div>
         );
       })}
 
       {/* Uncategorized Products */}
       {filteredProducts.filter((p) => !p.category_id).length > 0 && (
         <div className="mt-6">
           <h2 className="text-base font-display font-bold px-4 mb-3">Outros</h2>
           <div className="space-y-3 px-4">
             {filteredProducts
               .filter((p) => !p.category_id)
                .map((product) => {
                 const displayPrice = getDisplayPrice(product);
                 const isSelectableCombo = selectableComboProductIds.has(product.id);
                 const isAcaiProduct = !!product.category_id && acaiCategoryIds.includes(product.category_id);
                 return (
                   <ProductCard
                     key={product.id}
                     product={{ ...product, price: displayPrice }}
                     onClick={() => handleProductClick(product)}
                     onQuickAdd={(e) => handleQuickAdd(product, e)}
                     quantityInCart={getProductQuantityInCart(product.id)}
                     isRecentlyAdded={recentlyAddedId === product.id}
                     isFavorite={favoriteProductIds.includes(product.id)}
                     onToggleFavorite={(e) => handleToggleFavoriteClick(product.id, e)}
                     isCombo={comboProductIds.has(product.id)}
                     isSelectableCombo={isSelectableCombo}
                     isAcaiProduct={isAcaiProduct}
                   />
                 );
               })}
           </div>
         </div>
       )}

      {/* Empty State */}
      {filteredProducts.length === 0 && (
        <div className="mt-20 text-center px-4">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto mb-4">
            <Search className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground mb-4">Nenhum item encontrado</p>
          {searchQuery && (
            <Button variant="outline" onClick={() => setSearchQuery('')} className="h-10">
              Limpar busca
            </Button>
          )}
        </div>
      )}

      {/* Bottom Mobile Navigation */}
       {isMobile && !checkoutMode && (
         <nav className="fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-background via-background/95 to-background/80 backdrop-blur-md">
           <div className="mx-auto max-w-md px-4 pb-4 pt-2">
             <div className="flex items-center justify-around py-2 rounded-3xl bg-card border border-border shadow-card">
               <button
                 type="button"
                 onClick={() => scrollToCategory(null)}
                 className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
               >
                 <Home className="h-5 w-5" />
                 <span>Início</span>
               </button>
 
               <button
                 type="button"
                 onClick={() => {
                   navigate(`/my-orders?company=${company.slug}`);
                 }}
                 className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
               >
                 <ShoppingBag className="h-5 w-5" />
                 <span>Pedidos</span>
               </button>
 
               <button
                 type="button"
                 onClick={() => {
                   setShowOnlyFavorites((prev) => {
                     const next = !prev;
                     if (!next) {
                       scrollToCategory(null);
                     }
                     return next;
                   });
                 }}
                 className={cn(
                   "flex flex-col items-center gap-1 text-[11px] active:scale-95 transition-transform",
                   showOnlyFavorites
                     ? "text-primary"
                     : "text-muted-foreground hover:text-foreground"
                 )}
               >
                 <Heart className="h-5 w-5" />
                 <span>Favoritos</span>
               </button>
 
               <button
                 type="button"
                 onClick={() => setCartOpen(true)}
                 className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground active:scale-95 transition-transform relative"
               >
                 <ShoppingBag className="h-5 w-5" />
                 {itemCount > 0 && (
                   <span className="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                     {itemCount}
                   </span>
                 )}
                 <span>Sacola</span>
               </button>
             </div>
           </div>
         </nav>
       )}

      {/* Floating Cart Button */}
      {!isMobile && itemCount > 0 && !checkoutMode && !cartOpen && !selectedProduct && !halfHalfModalOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-gradient-to-t from-background via-background to-transparent pt-8">
          <Button
            className={cn(
              "w-full gradient-primary text-primary-foreground shadow-xl h-14 text-base rounded-2xl transition-all",
              cartBounce ? "scale-105 shadow-2xl" : "active:scale-[0.98]"
            )}
            onClick={() => setCartOpen(true)}
          >
            <div className="flex items-center justify-between w-full px-1">
              <div className="flex items-center gap-2">
                <div className={cn("relative transition-transform", cartBounce && "animate-bounce")}>
                  <ShoppingBag className="h-5 w-5" />
                  <span className={cn(
                    "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-background text-primary text-xs font-bold flex items-center justify-center transition-transform",
                    cartBounce && "scale-125"
                  )}>
                    {itemCount}
                  </span>
                </div>
                <span className="font-semibold">Ver sacola</span>
              </div>
              <span className="font-bold text-lg">R$ {subtotal.toFixed(2)}</span>
            </div>
          </Button>
        </div>
      )}

      {/* Product Modal */}
      <ProductModal
        product={selectedProduct}
        open={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />

      {/* Cart Drawer */}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          // Block checkout if table/session mode is active but session is invalid
          if ((tableNumber || sessionToken) && tableSessionValid !== true) {
            toast.error('Peça ao garçom para abrir sua mesa antes de fazer o pedido.');
            return;
          }
          setCartOpen(false);
          setCheckoutMode(true);
        }}
        onContinueShopping={() => setCartOpen(false)}
        deliveryFee={Number(company.delivery_fee) || 0}
        suggestedProducts={smartSuggestions}
        isStoreOpen={isActuallyOpen}
      />


      {/* Half-Half Pizza Modal */}
      {pizzaProducts.length >= 2 && (
        <HalfHalfPizzaModal
          open={halfHalfModalOpen}
          onClose={() => setHalfHalfModalOpen(false)}
          pizzaProducts={pizzaProducts}
          maxFlavors={pizzaConfig.settings?.max_flavors ?? 2}
          enableCrust={pizzaConfig.settings?.enable_crust ?? true}
          enableAddons={pizzaConfig.settings?.enable_addons ?? true}
          allowCrustExtraPrice={pizzaConfig.settings?.allow_crust_extra_price ?? true}
          companyId={company.id}
        />
      )}

      {/* Combo Modal */}
      {selectedCombo && (
        <ComboModal
          open={!!selectedCombo}
          onClose={() => setSelectedCombo(null)}
          comboProductId={selectedCombo.id}
          comboName={selectedCombo.name}
          comboDescription={selectedCombo.description}
          comboImageUrl={selectedCombo.image_url}
          comboPrice={getDisplayPrice(selectedCombo)}
          companyId={company.id}
        />
      )}

      {/* Customer Count Modal for new table sessions */}
      {tableNumber && (
        <CustomerCountModal
          open={showCustomerCountModal}
          onConfirm={handleCustomerCountConfirm}
          tableNumber={tableNumber}
        />
      )}

      {/* My Tickets Modal */}
      {storedCustomerId && company && (
        <MyTicketsModal
          open={showMyTicketsModal}
          onClose={() => setShowMyTicketsModal(false)}
          customerId={storedCustomerId}
          companyId={company.id}
        />
      )}
    </div>
  );
}

// Featured Product Card - Horizontal scroll variant
function FeaturedProductCard({
  product,
  onClick,
  onQuickAdd,
  quantityInCart,
  isRecentlyAdded,
  isFavorite,
  onToggleFavorite,
  isCombo = false,
}: {
  product: Product;
  onClick: () => void;
  onQuickAdd: (e: React.MouseEvent) => void;
  quantityInCart: number;
  isRecentlyAdded?: boolean;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  isCombo?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex-shrink-0 w-40 bg-card rounded-2xl border overflow-hidden text-left group transition-all active:scale-[0.98]",
        isRecentlyAdded 
          ? "border-primary ring-2 ring-primary/20 scale-[1.02]" 
          : "border-border hover:border-primary/30"
      )}
    >
      {/* Image */}
      <div className="relative aspect-square bg-secondary">
        {product.image_url ? (
          <OptimizedImage
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
            containerClassName="w-full h-full"
            fallback={
              <div className="w-full h-full flex items-center justify-center">
                <Store className="h-10 w-10 text-muted-foreground/30" />
              </div>
            }
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Store className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}

        {/* Favorite Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(e);
          }}
          className="absolute top-2 left-2 w-8 h-8 rounded-full bg-background/80 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
        >
          <Heart className={cn("h-4 w-4", isFavorite && "fill-primary text-primary")} />
        </button>
        
        {/* Quantity Badge with animation */}
        {quantityInCart > 0 && (
          <div className={cn(
            "absolute top-2 right-2 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shadow-lg transition-transform",
            isRecentlyAdded && "animate-bounce"
          )}>
            {quantityInCart}
          </div>
        )}
        
        {/* Success overlay */}
        {isRecentlyAdded && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center animate-scale-in">
              <Check className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        <div className="flex items-start gap-1 mb-1">
          <h3 className="font-semibold text-sm line-clamp-2 leading-tight flex-1">
            {product.name}
          </h3>
          {isCombo && (
            <Badge className="bg-primary/10 text-primary border-0 text-[9px] px-1 py-0 flex-shrink-0">
              🎁
            </Badge>
          )}
        </div>
        {Number(product.price) > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {product.promotional_price && Number(product.promotional_price) > 0 ? (
              <>
                <span className="text-xs text-muted-foreground line-through">
                  R$ {Number(product.price).toFixed(2)}
                </span>
                <span className="text-primary font-bold text-sm">
                  R$ {Number(product.promotional_price).toFixed(2)}
                </span>
              </>
            ) : (
              <span className="text-primary font-bold text-sm">
                R$ {Number(product.price).toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Quick Add Button */}
      <button
        onClick={onQuickAdd}
        className={cn(
          "absolute bottom-3 right-3 w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-all",
          isRecentlyAdded
            ? "bg-green-500 text-white scale-110"
            : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-90"
        )}
      >
        {isRecentlyAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </button>
    </button>
  );
}

// Product Card - List variant
function ProductCard({
  product,
  onClick,
  onQuickAdd,
  quantityInCart,
  isRecentlyAdded,
  isFavorite,
  onToggleFavorite,
  isCombo = false,
  isSelectableCombo = false,
  isAcaiProduct = false,
}: {
  product: Product;
  onClick: () => void;
  onQuickAdd: (e: React.MouseEvent) => void;
  quantityInCart: number;
  isRecentlyAdded?: boolean;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  isCombo?: boolean;
  isSelectableCombo?: boolean;
  isAcaiProduct?: boolean;
}) {
  const hasOptions = product.product_options && product.product_options.length > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full text-left rounded-3xl bg-card group transition-all active:scale-[0.99] overflow-hidden",
        "shadow-card border border-border/60",
        isRecentlyAdded
          ? "border-primary ring-2 ring-primary/20 scale-[1.01]"
          : quantityInCart > 0
            ? "border-primary/30 bg-primary/[0.02]"
            : "hover:border-primary/25 hover:shadow-lg"
      )}
    >
      {/* Favorite Button - Always visible */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(e);
        }}
        className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-background/80 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
      >
        <Heart className={cn("h-4 w-4", isFavorite && "fill-primary text-primary")} />
      </button>

      {/* Success overlay */}
      {isRecentlyAdded && (
        <div className="absolute inset-0 bg-primary/10 pointer-events-none rounded-3xl" />
      )}

      <div className="flex items-stretch gap-3 p-3">
        {/* Image side */}
        <div className="relative flex-shrink-0 w-24 h-24 rounded-2xl overflow-hidden bg-secondary">
          {product.image_url ? (
            <OptimizedImage
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-cover"
              containerClassName="w-full h-full"
              fallback={
                <div className="w-full h-full flex items-center justify-center">
                  <Store className="h-8 w-8 text-muted-foreground/30" />
                </div>
              }
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Store className="h-8 w-8 text-muted-foreground/30" />
            </div>
          )}

          {/* Quantity Badge */}
          {quantityInCart > 0 && (
            <div
              className={cn(
                "absolute bottom-1 left-1 h-6 min-w-6 px-2 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center shadow-lg transition-transform",
                isRecentlyAdded && "animate-bounce"
              )}
            >
              {quantityInCart}x
            </div>
          )}
        </div>

        {/* Content side */}
        <div className="flex-1 min-w-0 flex flex-col justify-between pr-8">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-[15px] leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                {product.name}
              </h3>
              {isCombo && (
                <Badge className="bg-primary/10 text-primary border-0 text-[10px] px-1.5 py-0.5 flex-shrink-0">
                  🎁 Combo
                </Badge>
              )}
            </div>

            {product.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                {product.description}
              </p>
            )}
          </div>

          <div className="mt-1 flex items-center justify-between gap-3">
            <div>
              {isSelectableCombo ? (
                <span className="text-sm font-semibold text-primary">
                  Monte seu combo
                </span>
              ) : isAcaiProduct ? (
                <span className="text-sm font-semibold text-primary">
                  Personalizável
                </span>
              ) : Number(product.price) > 0 ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {product.promotional_price && Number(product.promotional_price) > 0 ? (
                    <>
                      <span className="text-xs text-muted-foreground line-through">
                        R$ {Number(product.price).toFixed(2)}
                      </span>
                      <span className="text-base font-bold text-primary">
                        R$ {Number(product.promotional_price).toFixed(2)}
                      </span>
                    </>
                  ) : (
                    <span className="text-base font-bold text-primary">
                      R$ {Number(product.price).toFixed(2)}
                    </span>
                  )}
                </div>
              ) : null}
              {hasOptions && !isSelectableCombo && !isAcaiProduct && (
                <p className="text-[11px] text-muted-foreground">Personalizável</p>
              )}
            </div>

            <Button
              type="button"
              size="icon"
              className="rounded-full h-9 w-9 shadow-md flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onQuickAdd(e);
              }}
            >
              {quantityInCart > 0 ? (
                <Check className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </button>
  );
}

function MenuSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header Skeleton */}
      <div className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 p-3">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="w-10 h-10 rounded-xl" />
          <div className="flex-1">
            <Skeleton className="h-5 w-32 mb-1" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="px-3 pb-3">
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
        <div className="flex gap-2 px-3 pb-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9 w-20 rounded-full flex-shrink-0" />
          ))}
        </div>
      </div>

      {/* Featured Skeleton */}
      <div className="mt-6">
        <Skeleton className="h-5 w-32 mx-4 mb-3" />
        <div className="flex gap-3 overflow-hidden px-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="w-40 h-52 rounded-2xl flex-shrink-0" />
          ))}
        </div>
      </div>

      {/* Products Skeleton */}
      <div className="mt-6 px-4">
        <Skeleton className="h-5 w-24 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function PublicMenu() {
  return (
    <CartProvider>
      <PublicMenuContent />
    </CartProvider>
  );
}
