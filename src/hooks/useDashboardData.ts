import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

export type PeriodFilter = "today" | "7days" | "30days";

export interface DashboardStats {
  ordersPeriod: number;
  ordersPrevious: number;
  revenuePeriod: number;
  revenuePrevious: number;
  averageTicket: number;
  averageTicketPrevious: number;
  pendingOrders: number;
  inDeliveryOrders: number;
  deliveredPeriod: number;
  cancelledPeriod: number;
  tableOrdersPeriod: number;
  tableRevenuePeriod: number;
}

export interface ChartData {
  date: string;
  orders: number;
  revenue: number;
}

export interface OrderStatusData {
  name: string;
  value: number;
  color: string;
}

export interface RecentOrder {
  id: string;
  created_at: string;
  customer_name: string;
  total: number;
  status: string;
}

export interface TopProduct {
  name: string;
  quantity: number;
  revenue: number;
}

export interface InventoryIngredient {
  name: string;
  unit: string;
  current_stock: number;
  min_stock: number;
}

export interface InventoryOverview {
  lowStockCount: number;
  unavailableProductsCount: number;
  criticalIngredients: InventoryIngredient[];
}

export interface IngredientFinancialStats {
  purchasesCost: number;
  consumptionCost: number;
  grossMargin: number;
  grossMarginPercent: number;
}

export interface FullOrderData {
  id: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  total: number;
  subtotal: number;
  delivery_fee: number;
  status: string;
  payment_method: string;
  payment_status: string;
}

const statusColors: Record<string, string> = {
  pending: "#eab308",
  confirmed: "#3b82f6",
  preparing: "#f97316",
  ready: "#a855f7",
  out_for_delivery: "#06b6d4",
  delivered: "#22c55e",
  cancelled: "#ef4444",
};

const statusLabels: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Pronto",
  out_for_delivery: "Em entrega",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

async function fetchCompany(userId: string, staffCompanyId?: string) {
  const query = staffCompanyId
    ? supabase.from("companies").select("id, name, status, niche").eq("id", staffCompanyId).single()
    : supabase.from("companies").select("id, name, status, niche").eq("owner_id", userId).maybeSingle();

  const { data } = await query;
  return data;
}

async function fetchOrders(companyId: string) {
  const { data } = await supabase
    .from("orders")
    .select(
      "id, created_at, total, subtotal, delivery_fee, status, customer_name, customer_phone, payment_method, payment_status, source"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  return data || [];
}

async function fetchOrderItems(orderIds: string[]) {
  if (orderIds.length === 0) return [];

  const { data } = await supabase
    .from("order_items")
    .select("product_name, quantity, total_price")
    .in("order_id", orderIds);

  return data || [];
}

async function fetchInventoryData(companyId: string) {
  const { data: ingredients } = await supabase
    .from("inventory_ingredients")
    .select("name, unit, current_stock, min_stock")
    .eq("company_id", companyId)
    .order("name");

  return ingredients || [];
}

async function fetchUnavailableProducts(companyId: string) {
  try {
    const { data, error } = await supabase.functions.invoke("get-unavailable-products", {
      body: { companyId },
    });

    if (error) {
      console.warn("Failed to fetch unavailable products:", error);
      return 0;
    }

    return data?.ok ? (data.unavailableProductIds || []).length : 0;
  } catch (err) {
    console.warn("Error fetching unavailable products:", err);
    return 0;
  }
}

async function fetchInventoryMovements(companyId: string, periodStart: string, periodEnd: string) {
  const { data } = await supabase
    .from("inventory_movements")
    .select(
      `quantity, movement_type, unit_cost, ingredient_id,
       inventory_ingredients ( average_unit_cost )`
    )
    .eq("company_id", companyId)
    .gte("created_at", periodStart)
    .lte("created_at", periodEnd);

  return data || [];
}

function calculateStats(
  allOrders: any[],
  periodStart: string,
  periodEnd: string,
  previousStart: string,
  previousEnd: string
): DashboardStats {
  const ordersPeriod = allOrders.filter(
    (o) => o.created_at >= periodStart && o.created_at <= periodEnd
  );
  const ordersPrevious = allOrders.filter(
    (o) => o.created_at >= previousStart && o.created_at <= previousEnd
  );

  const revenuePeriod = ordersPeriod
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.total, 0);
  const revenuePrevious = ordersPrevious
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.total, 0);

  const validOrdersPeriod = ordersPeriod.filter((o) => o.status !== "cancelled");
  const validOrdersPrevious = ordersPrevious.filter((o) => o.status !== "cancelled");

  const averageTicket = validOrdersPeriod.length > 0 ? revenuePeriod / validOrdersPeriod.length : 0;
  const averageTicketPrevious =
    validOrdersPrevious.length > 0 ? revenuePrevious / validOrdersPrevious.length : 0;

  const pendingOrders = allOrders.filter((o) =>
    ["pending", "confirmed", "preparing", "ready"].includes(o.status)
  ).length;
  const inDeliveryOrders = allOrders.filter((o) => o.status === "out_for_delivery").length;
  const deliveredPeriod = ordersPeriod.filter((o) => o.status === "delivered").length;
  const cancelledPeriod = ordersPeriod.filter((o) => o.status === "cancelled").length;

  const tableOrdersPeriod = ordersPeriod.filter(
    (o: any) => o.source === "table" && o.status !== "cancelled"
  ).length;
  const tableRevenuePeriod = ordersPeriod
    .filter((o: any) => o.source === "table" && o.status !== "cancelled")
    .reduce((sum, o) => sum + o.total, 0);

  return {
    ordersPeriod: ordersPeriod.length,
    ordersPrevious: ordersPrevious.length,
    revenuePeriod,
    revenuePrevious,
    averageTicket,
    averageTicketPrevious,
    pendingOrders,
    inDeliveryOrders,
    deliveredPeriod,
    cancelledPeriod,
    tableOrdersPeriod,
    tableRevenuePeriod,
  };
}

function calculateChartData(allOrders: any[], periodDays: number): ChartData[] {
  const today = new Date();
  const chartDays: ChartData[] = [];

  for (let i = periodDays - 1; i >= 0; i--) {
    const date = subDays(today, i);
    const dayStart = startOfDay(date).toISOString();
    const dayEnd = endOfDay(date).toISOString();

    const dayOrders = allOrders.filter(
      (o) => o.created_at >= dayStart && o.created_at <= dayEnd && o.status !== "cancelled"
    );

    chartDays.push({
      date:
        periodDays <= 7
          ? format(date, "EEE", { locale: ptBR })
          : format(date, "dd/MM", { locale: ptBR }),
      orders: dayOrders.length,
      revenue: dayOrders.reduce((sum, o) => sum + o.total, 0),
    });
  }

  return chartDays;
}

function calculateStatusData(allOrders: any[]): OrderStatusData[] {
  const statusCounts: Record<string, number> = {};
  allOrders.forEach((o) => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  });

  return Object.entries(statusCounts)
    .filter(([_, count]) => count > 0)
    .map(([status, count]) => ({
      name: statusLabels[status] || status,
      value: count,
      color: statusColors[status] || "#6b7280",
    }));
}

function calculateTopProducts(orderItems: any[]): TopProduct[] {
  const productMap = new Map<string, { quantity: number; revenue: number }>();

  orderItems.forEach((item) => {
    const existing = productMap.get(item.product_name) || { quantity: 0, revenue: 0 };
    productMap.set(item.product_name, {
      quantity: existing.quantity + item.quantity,
      revenue: existing.revenue + item.total_price,
    });
  });

  return Array.from(productMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);
}

function calculateInventoryOverview(
  ingredients: InventoryIngredient[],
  unavailableCount: number
): InventoryOverview {
  const lowStockIngredients = ingredients.filter(
    (ingredient) =>
      typeof ingredient.min_stock === "number" &&
      ingredient.min_stock > 0 &&
      typeof ingredient.current_stock === "number" &&
      ingredient.current_stock <= ingredient.min_stock
  );

  const sortedLowStock = [...lowStockIngredients].sort((a, b) => {
    const ratioA = a.min_stock > 0 ? a.current_stock / a.min_stock : 1;
    const ratioB = b.min_stock > 0 ? b.current_stock / b.min_stock : 1;
    return ratioA - ratioB;
  });

  return {
    lowStockCount: sortedLowStock.length,
    unavailableProductsCount: unavailableCount,
    criticalIngredients: sortedLowStock.slice(0, 5),
  };
}

function calculateIngredientFinancials(
  movements: any[],
  revenuePeriod: number
): IngredientFinancialStats {
  let purchasesCost = 0;
  let consumptionCost = 0;

  movements.forEach((row: any) => {
    const qty = Number(row.quantity) || 0;
    if (row.movement_type === "purchase") {
      const unitCost = Number(row.unit_cost) || 0;
      purchasesCost += qty * unitCost;
    }
    if (row.movement_type === "consumption") {
      const unitCost =
        typeof row.unit_cost === "number" && !isNaN(row.unit_cost)
          ? row.unit_cost
          : Number(row.inventory_ingredients?.average_unit_cost) || 0;
      const absQty = Math.abs(qty);
      consumptionCost += absQty * unitCost;
    }
  });

  const grossMargin = revenuePeriod - consumptionCost;
  const grossMarginPercent = revenuePeriod > 0 ? (grossMargin / revenuePeriod) * 100 : 0;

  return { purchasesCost, consumptionCost, grossMargin, grossMarginPercent };
}

export function useDashboardData(
  userId: string | undefined,
  period: PeriodFilter,
  staffCompanyId?: string
) {
  // Fetch company data
  const companyQuery = useQuery({
    queryKey: ["dashboard-company", userId, staffCompanyId],
    queryFn: () => fetchCompany(userId!, staffCompanyId),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const companyId = companyQuery.data?.id;

  // Fetch orders - cached separately for reuse
  const ordersQuery = useQuery({
    queryKey: ["dashboard-orders", companyId],
    queryFn: () => fetchOrders(companyId!),
    enabled: !!companyId,
    staleTime: 1000 * 60 * 1, // 1 minute - orders change frequently
  });

  // Calculate period ranges
  const today = new Date();
  let periodDays = 1;
  if (period === "7days") periodDays = 7;
  if (period === "30days") periodDays = 30;

  const periodStart = startOfDay(subDays(today, periodDays - 1)).toISOString();
  const periodEnd = endOfDay(today).toISOString();
  const previousStart = startOfDay(subDays(today, periodDays * 2 - 1)).toISOString();
  const previousEnd = endOfDay(subDays(today, periodDays)).toISOString();

  const allOrders = ordersQuery.data || [];
  const ordersPeriod = allOrders.filter(
    (o) => o.created_at >= periodStart && o.created_at <= periodEnd
  );
  const orderIds = ordersPeriod.map((o) => o.id);

  // Fetch order items for top products
  const orderItemsQuery = useQuery({
    queryKey: ["dashboard-order-items", orderIds.join(",")],
    queryFn: () => fetchOrderItems(orderIds),
    enabled: orderIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Fetch inventory data
  const inventoryQuery = useQuery({
    queryKey: ["dashboard-inventory", companyId],
    queryFn: () => fetchInventoryData(companyId!),
    enabled: !!companyId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch unavailable products
  const unavailableQuery = useQuery({
    queryKey: ["dashboard-unavailable", companyId],
    queryFn: () => fetchUnavailableProducts(companyId!),
    enabled: !!companyId,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch inventory movements
  const movementsQuery = useQuery({
    queryKey: ["dashboard-movements", companyId, periodStart, periodEnd],
    queryFn: () => fetchInventoryMovements(companyId!, periodStart, periodEnd),
    enabled: !!companyId,
    staleTime: 1000 * 60 * 2,
  });

  // Calculate all derived data
  const stats = allOrders.length > 0
    ? calculateStats(allOrders, periodStart, periodEnd, previousStart, previousEnd)
    : null;

  const chartData = allOrders.length > 0 ? calculateChartData(allOrders, periodDays) : [];

  const statusData = allOrders.length > 0 ? calculateStatusData(allOrders) : [];

  const recentOrders = allOrders.slice(0, 5) as RecentOrder[];

  const topProducts = orderItemsQuery.data
    ? calculateTopProducts(orderItemsQuery.data)
    : [];

  const inventoryOverview =
    inventoryQuery.data && unavailableQuery.data !== undefined
      ? calculateInventoryOverview(
          inventoryQuery.data as InventoryIngredient[],
          unavailableQuery.data
        )
      : null;

  const ingredientFinancials =
    movementsQuery.data && stats
      ? calculateIngredientFinancials(movementsQuery.data, stats.revenuePeriod)
      : { purchasesCost: 0, consumptionCost: 0, grossMargin: 0, grossMarginPercent: 0 };

  const isLoading =
    companyQuery.isLoading ||
    ordersQuery.isLoading ||
    (orderIds.length > 0 && orderItemsQuery.isLoading);

  const isFetching =
    companyQuery.isFetching ||
    ordersQuery.isFetching ||
    orderItemsQuery.isFetching ||
    inventoryQuery.isFetching ||
    movementsQuery.isFetching;

  return {
    company: companyQuery.data,
    companyId,
    companyName: companyQuery.data?.name || "",
    companyStatus: companyQuery.data?.status as "pending" | "approved" | "suspended" | null,
    stats: stats || {
      ordersPeriod: 0,
      ordersPrevious: 0,
      revenuePeriod: 0,
      revenuePrevious: 0,
      averageTicket: 0,
      averageTicketPrevious: 0,
      pendingOrders: 0,
      inDeliveryOrders: 0,
      deliveredPeriod: 0,
      cancelledPeriod: 0,
      tableOrdersPeriod: 0,
      tableRevenuePeriod: 0,
    },
    chartData,
    statusData,
    recentOrders,
    topProducts,
    inventoryOverview,
    ingredientFinancials,
    allOrdersData: allOrders as FullOrderData[],
    isLoading,
    isFetching,
    refetch: () => {
      companyQuery.refetch();
      ordersQuery.refetch();
      orderItemsQuery.refetch();
      inventoryQuery.refetch();
      unavailableQuery.refetch();
      movementsQuery.refetch();
    },
  };
}
