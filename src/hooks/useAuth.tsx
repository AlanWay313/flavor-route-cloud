import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'super_admin' | 'store_owner' | 'delivery_driver' | 'store_staff';

interface StaffCompanyInfo {
  companyId: string;
  companyName: string;
  companySlug: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  roles: AppRole[];
  staffCompany: StaffCompanyInfo | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, phone: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [staffCompany, setStaffCompany] = useState<StaffCompanyInfo | null>(null);

  const fetchUserRoles = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      // Se a tabela não existir ou houver erro, retorna array vazio sem travar
      if (error) {
        console.warn('Error fetching user roles (tabela pode não existir):', error.message);
        setRoles([]);
        return [];
      }
      const userRoles = data?.map(r => r.role as AppRole) || [];
      setRoles(userRoles);
      return userRoles;
    } catch (error) {
      console.warn('Error fetching user roles:', error);
      setRoles([]);
      return [];
    }
  }, []);

  const fetchStaffCompany = useCallback(async (userId: string) => {
    try {
      // Check if user is staff for any company
      const { data: staffData, error: staffError } = await supabase
        .from('company_staff')
        .select('company_id, companies:company_id(id, name, slug)')
        .eq('user_id', userId)
        .limit(1)
        .single();

      // Se a tabela não existir ou houver erro, retorna null sem travar
      if (staffError) {
        if (staffError.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.warn('Error fetching staff company (tabela pode não existir):', staffError.message);
        }
        setStaffCompany(null);
        return null;
      }

      if (!staffData) {
        setStaffCompany(null);
        return null;
      }

      const company = staffData.companies as any;
      if (company) {
        const companyInfo: StaffCompanyInfo = {
          companyId: company.id,
          companyName: company.name,
          companySlug: company.slug,
        };
        setStaffCompany(companyInfo);
        return companyInfo;
      }
      
      setStaffCompany(null);
      return null;
    } catch (error) {
      console.warn('Error fetching staff company:', error);
      setStaffCompany(null);
      return null;
    }
  }, []);

  const refreshRoles = useCallback(async () => {
    if (user?.id) {
      await fetchUserRoles(user.id);
    }
  }, [user?.id, fetchUserRoles]);

  useEffect(() => {
    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Only synchronous updates here
      setLoading(true);
      setSession(session);
      setUser(session?.user ?? null);

      // Defer role fetching to avoid deadlock
      if (session?.user) {
        setTimeout(async () => {
          try {
            const userRoles = await fetchUserRoles(session.user.id);
            
            // If user is store_staff, fetch their company
            if (userRoles.includes('store_staff')) {
              await fetchStaffCompany(session.user.id);
            } else {
              setStaffCompany(null);
            }
          } catch (error) {
            console.error('Error fetching user data:', error);
            setRoles([]);
            setStaffCompany(null);
          } finally {
            setLoading(false);
          }
        }, 0);
      } else {
        setRoles([]);
        setStaffCompany(null);
        setLoading(false);
      }
    });

    // THEN check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        try {
          const userRoles = await fetchUserRoles(session.user.id);
          
          // If user is store_staff, fetch their company
          if (userRoles.includes('store_staff')) {
            await fetchStaffCompany(session.user.id);
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          setRoles([]);
          setStaffCompany(null);
        }
      } else {
        setRoles([]);
        setStaffCompany(null);
      }

      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchUserRoles, fetchStaffCompany]);

  // Listen for realtime changes to user_roles table
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`user-roles-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_roles',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Refresh roles when there's any change
          fetchUserRoles(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchUserRoles]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName: string, phone: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          phone,
        },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    // Clear local state first to ensure UI updates immediately
    setUser(null);
    setSession(null);
    setRoles([]);
    setStaffCompany(null);
    
    // Then attempt to sign out from Supabase (ignore errors - local state is already cleared)
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const hasRole = (role: AppRole) => roles.includes(role);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        roles,
        staffCompany,
        signIn,
        signUp,
        signOut,
        hasRole,
        refreshRoles,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}