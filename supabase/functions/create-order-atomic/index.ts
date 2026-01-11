import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  options: unknown;
  notes: string | null;
  requires_preparation: boolean;
}

interface CreateOrderRequest {
  orderId: string;
  companyId: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  deliveryAddressId: string | null;
  paymentMethod: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  notes: string | null;
  needsChange: boolean;
  changeFor: number | null;
  couponId: string | null;
  referralCodeId: string | null;
  discountAmount: number;
  estimatedDeliveryTime: string;
  source: string;
  tableSessionId: string | null;
  items: OrderItem[];
}

/**
 * Edge function para criar pedidos de forma atômica
 * Garante que order e order_items são criados juntos ou nenhum é criado
 * Isso previne pedidos "vazios" no painel do lojista
 */
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body: CreateOrderRequest = await req.json()

    console.log('Creating order atomically:', body.orderId)

    // Validação básica
    if (!body.orderId || !body.companyId || !body.items?.length) {
      return new Response(
        JSON.stringify({ error: 'Dados incompletos para criação do pedido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Usar RPC para transação atômica (ou fazer sequencialmente com rollback manual)
    // Como Supabase JS não suporta transações nativas, fazemos com rollback manual

    // 1. Criar o pedido
    const { error: orderError } = await supabase
      .from('orders')
      .insert({
        id: body.orderId,
        company_id: body.companyId,
        customer_id: body.customerId,
        customer_name: body.customerName,
        customer_phone: body.customerPhone,
        customer_email: body.customerEmail.toLowerCase().trim(),
        delivery_address_id: body.deliveryAddressId,
        payment_method: body.paymentMethod,
        subtotal: body.subtotal,
        delivery_fee: body.deliveryFee,
        total: body.total,
        notes: body.notes,
        needs_change: body.needsChange,
        change_for: body.changeFor,
        coupon_id: body.couponId,
        referral_code_id: body.referralCodeId,
        discount_amount: body.discountAmount,
        estimated_delivery_time: body.estimatedDeliveryTime,
        source: body.source,
        table_session_id: body.tableSessionId,
        status: 'pending',
        payment_status: 'pending',
      })

    if (orderError) {
      console.error('Error creating order:', orderError)
      throw new Error(`Falha ao criar pedido: ${orderError.message}`)
    }

    // 2. Preparar items com order_id
    const orderItems = body.items.map(item => ({
      order_id: body.orderId,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      options: item.options,
      notes: item.notes,
      requires_preparation: item.requires_preparation,
    }))

    // 3. Inserir items
    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)

    if (itemsError) {
      console.error('Error creating order items:', itemsError)
      
      // ROLLBACK: Deletar o pedido criado
      console.log('Rolling back order creation:', body.orderId)
      const { error: rollbackError } = await supabase
        .from('orders')
        .delete()
        .eq('id', body.orderId)

      if (rollbackError) {
        console.error('Failed to rollback order:', rollbackError)
        // Mesmo com falha no rollback, reportar o erro original
      }

      throw new Error(`Falha ao criar itens do pedido: ${itemsError.message}`)
    }

    // 4. Atualizar sessão da mesa se aplicável
    if (body.tableSessionId && body.customerName) {
      await supabase
        .from('table_sessions')
        .update({
          customer_name: body.customerName,
          customer_phone: body.customerPhone || null,
        })
        .eq('id', body.tableSessionId)
    }

    // 5. Atualizar uso do cupom se aplicável
    if (body.couponId) {
      try {
        await supabase.rpc('increment_coupon_usage', { coupon_id: body.couponId })
      } catch (e: unknown) {
        console.warn('Could not increment coupon usage:', e)
      }
    }

    console.log('Order created successfully:', body.orderId)

    return new Response(
      JSON.stringify({ 
        success: true, 
        orderId: body.orderId,
        message: 'Pedido criado com sucesso'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in create-order-atomic:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Erro interno ao criar pedido',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
