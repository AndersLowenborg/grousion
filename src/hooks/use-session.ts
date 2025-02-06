
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from "@/hooks/use-toast";

interface Session {
  id: number;
  created_at: string;
  created_by: string | null;
  name: string | null;
  status: string | null;
  test_mode: boolean;
  test_participants_count: number;
}

export const useSession = (sessionId: number) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: session, isLoading: isLoadingSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      console.log('Fetching session details for ID:', sessionId);
      const { data, error } = await supabase
        .from('Sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) throw error;
      console.log('Session details:', data);
      return data as Session;
    },
    enabled: !!sessionId,
  });

  const updateSessionMutation = useMutation({
    mutationFn: async (newName: string) => {
      const { data, error } = await supabase
        .from('Sessions')
        .update({ name: newName } as Partial<Session>)
        .eq('id', sessionId)
        .select()
        .single();

      if (error) throw error;
      return data as Session;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      toast({
        title: "Success",
        description: "Session name updated successfully",
      });
    },
    onError: (error) => {
      console.error('Error updating session:', error);
      toast({
        title: "Error",
        description: "Failed to update session name",
        variant: "destructive",
      });
    },
  });

  return {
    session,
    isLoadingSession,
    updateSession: updateSessionMutation.mutate,
  };
};
