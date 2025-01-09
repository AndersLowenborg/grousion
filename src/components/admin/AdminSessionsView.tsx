import { useUser } from '@supabase/auth-helpers-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SessionsTable } from './SessionsTable';
import { CreateSessionButton } from './CreateSessionButton';

export const AdminSessionsView = () => {
  const user = useUser();
  const { toast } = useToast();

  const { data: sessionsWithUsers, isLoading, error } = useQuery({
    queryKey: ['admin-sessions', user?.id],
    queryFn: async () => {
      if (!user) {
        console.error('No user found in AdminSessionsView');
        return [];
      }

      try {
        const { data: sessions, error: sessionsError } = await supabase
          .from('Sessions')
          .select('*')
          .eq('created_by', user.id)
          .order('created_at', { ascending: false });

        if (sessionsError) {
          console.error('Error fetching sessions:', sessionsError);
          if (sessionsError.code === '429') {
            throw new Error('Too many requests. Please wait a moment and try again.');
          }
          throw sessionsError;
        }

        if (!sessions) {
          return [];
        }

        const sessionsWithUsers = await Promise.all(
          sessions.map(async (session) => {
            const { data: users, error: usersError } = await supabase
              .from('SessionUsers')
              .select('id, name')
              .eq('session_id', session.id);

            if (usersError) {
              console.error('Error fetching users for session:', session.id, usersError);
              return {
                ...session,
                users: [],
              };
            }

            return {
              ...session,
              users: users || [],
            };
          })
        );

        return sessionsWithUsers;
      } catch (error) {
        console.error('Error in session fetch:', error);
        throw error;
      }
    },
    enabled: !!user,
    retry: (failureCount, error) => {
      // Don't retry on 429 errors
      if (error?.message?.includes('Too many requests')) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please log in to view your sessions.</p>
      </div>
    );
  }

  if (error) {
    console.error('Error in AdminSessionsView:', error);
    toast({
      title: "Error Loading Sessions",
      description: error?.message || "There was a problem loading your sessions. Please try again.",
      variant: "destructive",
    });
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-red-500">
          {error?.message?.includes('Too many requests') 
            ? "Too many requests. Please wait a moment and try again." 
            : "Error loading sessions. Please refresh the page."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Your Sessions</h2>
        <CreateSessionButton />
      </div>
      
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted-foreground">Loading sessions...</p>
        </div>
      ) : sessionsWithUsers && sessionsWithUsers.length > 0 ? (
        <SessionsTable sessions={sessionsWithUsers} />
      ) : (
        <div className="flex items-center justify-center min-h-[200px] border rounded-lg">
          <p className="text-muted-foreground">No sessions found. Create one to get started!</p>
        </div>
      )}
    </div>
  );
};