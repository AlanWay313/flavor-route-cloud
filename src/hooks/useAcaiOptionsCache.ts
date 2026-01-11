import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AcaiSize {
  id: string;
  name: string;
  base_price: number;
  sort_order: number;
}

interface AcaiOptionGroup {
  id: string;
  size_id: string;
  name: string;
  description: string | null;
  min_selections: number;
  max_selections: number;
  free_quantity: number;
  extra_price_per_item: number;
  sort_order: number;
}

interface AcaiOption {
  id: string;
  group_id: string;
  name: string;
  description: string | null;
  price_modifier: number;
  is_available: boolean;
  sort_order: number;
}

export interface AcaiCategoryCache {
  sizes: AcaiSize[];
  optionGroups: AcaiOptionGroup[];
  options: AcaiOption[];
}

// Cache global para persistir entre re-renders
const globalAcaiCache: Record<string, AcaiCategoryCache> = {};

export function useAcaiOptionsCache() {
  const loadingRef = useRef<Record<string, boolean>>({});

  const preloadAcaiOptions = useCallback(async (categoryIds: string[]) => {
    if (!categoryIds.length) return;

    // Filtrar categorias que ainda não foram carregadas
    const toLoad = categoryIds.filter(
      (id) => !globalAcaiCache[id] && !loadingRef.current[id]
    );

    if (!toLoad.length) return;

    // Marcar como carregando
    toLoad.forEach((id) => {
      loadingRef.current[id] = true;
    });

    try {
      // Buscar todos os tamanhos de todas as categorias de uma vez
      const { data: sizesData, error: sizesError } = await supabase
        .from('acai_category_sizes')
        .select('id, category_id, name, base_price, sort_order')
        .in('category_id', toLoad)
        .order('sort_order');

      if (sizesError) throw sizesError;

      const allSizeIds = (sizesData || []).map((s) => s.id);

      // Se não há tamanhos, não há o que carregar
      if (!allSizeIds.length) {
        toLoad.forEach((id) => {
          globalAcaiCache[id] = { sizes: [], optionGroups: [], options: [] };
          loadingRef.current[id] = false;
        });
        return;
      }

      // Buscar todos os grupos de opções
      const { data: groupsData, error: groupsError } = await supabase
        .from('acai_size_option_groups')
        .select('*')
        .in('size_id', allSizeIds)
        .order('sort_order');

      if (groupsError) throw groupsError;

      // Buscar todas as opções
      let optionsData: any[] = [];
      if (groupsData && groupsData.length > 0) {
        const allGroupIds = groupsData.map((g) => g.id);
        const { data: opts, error: optsError } = await supabase
          .from('acai_size_options')
          .select('*')
          .in('group_id', allGroupIds)
          .eq('is_available', true)
          .order('sort_order');

        if (optsError) throw optsError;
        optionsData = opts || [];
      }

      // Organizar dados por categoria
      toLoad.forEach((categoryId) => {
        const categorySizes = (sizesData || [])
          .filter((s: any) => s.category_id === categoryId)
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            base_price: Number(s.base_price ?? 0),
            sort_order: s.sort_order ?? 0,
          }));

        const sizeIds = categorySizes.map((s) => s.id);

        const categoryGroups = (groupsData || [])
          .filter((g: any) => sizeIds.includes(g.size_id))
          .map((g: any) => ({
            id: g.id,
            size_id: g.size_id,
            name: g.name,
            description: g.description,
            min_selections: g.min_selections || 0,
            max_selections: g.max_selections || 10,
            free_quantity: g.free_quantity || 0,
            extra_price_per_item: g.extra_price_per_item || 0,
            sort_order: g.sort_order || 0,
          }));

        const groupIds = categoryGroups.map((g) => g.id);

        const categoryOptions = optionsData
          .filter((o: any) => groupIds.includes(o.group_id))
          .map((o: any) => ({
            id: o.id,
            group_id: o.group_id,
            name: o.name,
            description: o.description,
            price_modifier: Number(o.price_modifier ?? 0),
            is_available: o.is_available !== false,
            sort_order: o.sort_order || 0,
          }));

        globalAcaiCache[categoryId] = {
          sizes: categorySizes,
          optionGroups: categoryGroups,
          options: categoryOptions,
        };

        loadingRef.current[categoryId] = false;
      });
    } catch (error) {
      console.error('Error preloading açaí options:', error);
      toLoad.forEach((id) => {
        loadingRef.current[id] = false;
      });
    }
  }, []);

  const getAcaiCache = useCallback((categoryId: string): AcaiCategoryCache | null => {
    return globalAcaiCache[categoryId] || null;
  }, []);

  const isLoading = useCallback((categoryId: string): boolean => {
    return loadingRef.current[categoryId] || false;
  }, []);

  return {
    preloadAcaiOptions,
    getAcaiCache,
    isLoading,
  };
}
