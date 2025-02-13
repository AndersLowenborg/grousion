
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { JoinSessionForm } from '@/components/session/JoinSessionForm';
import { UserResponseForm } from '@/components/session/UserResponseForm';
import { WaitingPage } from '@/components/session/WaitingPage';
import { useEffect, useState } from 'react';
import { Statement } from '@/types/statement';

const UserPage = () => {
  const { id: sessionIdString } = useParams();
  const sessionId = sessionIdString ? parseInt(sessionIdString) : null;
  const queryClient = useQueryClient();

  // Get user's localStorage name to fetch the correct user data
  const storedName = localStorage.getItem(`session_${sessionId}_name`);
  console.log('Stored name from localStorage:', storedName);

  // Get the stored statement index from localStorage or default to 0
  const storedIndex = localStorage.getItem(`session_${sessionId}_statement_index`);
  const [currentStatementIndex, setCurrentStatementIndex] = useState(
    storedIndex ? parseInt(storedIndex) : 0
  );

  // Fetch session details to verify it's published
  const { data: session, isLoading: isLoadingSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error('Session ID is required');
      console.log('Fetching session details for user page:', sessionId);
      const { data, error } = await supabase
        .from('SESSION')
        .select('*')
        .eq('id', sessionId)
        .single();
      
      if (error) throw error;
      console.log('Session details retrieved:', data);
      return data;
    },
    enabled: !!sessionId,
  });

  // Fetch statements when session is started
  const { data: statements } = useQuery({
    queryKey: ['statements', sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error('Session ID is required');
      const { data, error } = await supabase
        .from('STATEMENT')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as Statement[];
    },
    enabled: !!sessionId && session?.status === 'STARTED',
  });

  // Fetch active rounds to determine statement status
  const { data: activeRounds } = useQuery({
    queryKey: ['active-rounds', sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error('Session ID is required');
      const { data, error } = await supabase
        .from('ROUND')
        .select('*')
        .eq('status', 'STARTED');

      if (error) throw error;
      return data;
    },
    enabled: !!sessionId,
  });

  // Fetch user information using the stored name
  const { data: userData } = useQuery({
    queryKey: ['user', sessionId, storedName],
    queryFn: async () => {
      if (!sessionId || !storedName) throw new Error('Session ID and name are required');
      console.log('Fetching user data with name:', storedName);
      
      const { data, error } = await supabase
        .from('SESSION_USERS')
        .select('*')
        .eq('session_id', sessionId)
        .eq('name', storedName)
        .maybeSingle();

      if (error) throw error;
      console.log('User data retrieved:', data);
      return data;
    },
    enabled: !!sessionId && !!storedName,
  });

  // Fetch user's answers to check progress
  const { data: userAnswers } = useQuery({
    queryKey: ['userAnswers', sessionId],
    queryFn: async () => {
      if (!sessionId || !userData?.id) return null;
      const { data, error } = await supabase
        .from('ANSWER')
        .select('*')
        .eq('respondant_id', userData.id)
        .eq('round_id', sessionId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!sessionId && !!userData?.id,
  });

  // Set up real-time subscription for session status changes
  useEffect(() => {
    if (!sessionId) return;

    console.log('Setting up real-time subscription for session status:', sessionId);
    
    const channel = supabase
      .channel(`session-status-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'SESSION',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          console.log('Session status changed:', payload);
          // Invalidate and refetch session data
          queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
          // Also invalidate statements and user data if needed
          queryClient.invalidateQueries({ queryKey: ['statements', sessionId] });
          queryClient.invalidateQueries({ queryKey: ['user', sessionId, storedName] });
        }
      )
      .subscribe();

    // Set up real-time subscription for SESSION_USERS changes
    const userChannel = supabase
      .channel(`session-users-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'SESSION_USERS',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          console.log('SESSION_USERS changed:', payload);
          queryClient.invalidateQueries({ queryKey: ['user', sessionId, storedName] });
        }
      )
      .subscribe();

    return () => {
      console.log('Cleaning up subscriptions');
      supabase.removeChannel(channel);
      supabase.removeChannel(userChannel);
    };
  }, [sessionId, queryClient, storedName]);

  // Save current statement index to localStorage when it changes
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(`session_${sessionId}_statement_index`, currentStatementIndex.toString());
    }
  }, [sessionId, currentStatementIndex]);

  if (isLoadingSession) {
    return (
      <div className="container mx-auto p-8">
        <p className="text-center">Loading session...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-8">
        <p className="text-center text-red-500">Session not found</p>
      </div>
    );
  }

  if (session.status === 'UNPUBLISHED') {
    return (
      <div className="container mx-auto p-8">
        <p className="text-center text-yellow-500">This session is not currently active</p>
      </div>
    );
  }

  const handleResponseSubmit = () => {
    if (statements && currentStatementIndex < statements.length - 1) {
      setCurrentStatementIndex(prev => prev + 1);
    }
  };

  // Map the Statement type to what UserResponseForm expects, checking active rounds
  const mapStatementToFormProps = (statement: Statement) => {
    const isActive = activeRounds?.some(round => 
      round.statement_id === statement.id && round.status === 'STARTED'
    );

    return {
      id: statement.id,
      content: statement.statement || '',
      status: isActive ? 'STARTED' : 'NOT_STARTED'
    };
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8 text-center">
        {session.status === 'STARTED' ? session.name : `Join Session: ${session.name}`}
      </h1>

      {userData?.name && (
        <p className="text-center text-lg mb-6">
          Welcome, <span className="font-semibold">{userData.name}</span>!
        </p>
      )}
      
      {session.status === 'PUBLISHED' && <JoinSessionForm />}
      
      {session.status === 'STARTED' && statements && statements.length > 0 && (
        <div className="mt-8">
          {!userAnswers ? (
            <>
              <p className="text-center mb-4">
                Statement {currentStatementIndex + 1} of {statements.length}
              </p>
              <UserResponseForm 
                statement={mapStatementToFormProps(statements[currentStatementIndex])}
                onSubmit={handleResponseSubmit}
              />
            </>
          ) : (
            <div className="mt-8">
              <WaitingPage />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserPage;
