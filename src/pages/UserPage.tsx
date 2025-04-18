import { useParams } from 'react-router-dom';
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { JoinSessionForm } from '@/components/session/JoinSessionForm';
import { UserResponseForm } from '@/components/session/UserResponseForm';
import { WaitingPage } from '@/components/session/WaitingPage';
import { PreviousRoundAnswers } from '@/components/session/PreviousRoundAnswers';
import { useEffect } from 'react';
import { Statement } from '@/types/statement';
import { Session } from '@/types/session';
import { useToast } from "@/hooks/use-toast";

const UserPage = () => {
  const { id: sessionIdString } = useParams();
  const sessionId = sessionIdString ? parseInt(sessionIdString) : null;
  const { toast } = useToast();

  const storedName = localStorage.getItem(`session_${sessionId}_name`);

  const { 
    data: session,
    isLoading: isLoadingSession
  } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error('Session ID is required');
      
      const { data, error } = await supabase
        .from('SESSION')
        .select('*')
        .eq('id', sessionId)
        .single();
      
      if (error) throw error;
      console.log('Session data:', data);
      return data as Session;
    },
    enabled: !!sessionId,
  });

  const {
    data: userData,
    isLoading: isLoadingUser
  } = useQuery({
    queryKey: ['user', sessionId, storedName],
    queryFn: async () => {
      if (!sessionId || !storedName) throw new Error('No stored user name found');
      
      const { data, error } = await supabase
        .from('SESSION_USERS')
        .select('*')
        .eq('session_id', sessionId)
        .eq('name', storedName)
        .single();
      
      if (error) throw error;
      console.log('User data:', data);
      return data;
    },
    enabled: !!sessionId && !!storedName,
  });

  const {
    data: currentRound,
    isLoading: isLoadingRound,
    error: roundError
  } = useQuery({
    queryKey: ['active-round', sessionId, session?.has_active_round],
    queryFn: async () => {
      if (!sessionId || !session?.has_active_round) {
        console.log('No active round found in session');
        return null;
      }

      console.log('Fetching round data for session.has_active_round:', session.has_active_round);

      const { data: roundData, error: roundError } = await supabase
        .from('ROUND')
        .select('*')
        .eq('id', session.has_active_round)
        .maybeSingle();

      if (roundError) {
        console.error('Round fetch error:', roundError);
        throw roundError;
      }
      
      console.log('Round data:', roundData);
      
      if (!roundData) {
        console.log('No round data found');
        return null;
      }

      console.log('Fetching statement with ID:', roundData.statement_id);

      try {
        const { data: statementData, error: statementError } = await supabase
          .from('STATEMENT')
          .select('id, statement, description, session_id')
          .eq('id', roundData.statement_id)
          .maybeSingle();

        if (statementError) {
          console.error('Statement fetch error:', statementError);
          throw statementError;
        }

        console.log('Statement data:', statementData);

        if (!statementData) {
          console.log('No statement found for ID:', roundData.statement_id);
          return null;
        }

        return {
          ...roundData,
          statement: statementData
        };
      } catch (error) {
        console.error('Detailed statement fetch error:', {
          error,
          roundData,
          statementId: roundData.statement_id
        });
        throw error;
      }
    },
    enabled: !!sessionId && !!session?.has_active_round,
    retry: false
  });

  const {
    data: userAnswer,
    isLoading: isLoadingAnswer
  } = useQuery({
    queryKey: ['user-answer', sessionId, userData?.id, session?.has_active_round],
    queryFn: async () => {
      if (!userData?.id || !session?.has_active_round) return null;

      const { data, error } = await supabase
        .from('ANSWER')
        .select('*')
        .eq('respondant_id', userData.id)
        .eq('round_id', session.has_active_round)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      console.log('User answer:', data);
      return data;
    },
    enabled: !!userData?.id && !!session?.has_active_round,
  });

  const {
    data: groupData,
    isLoading: isLoadingGroup
  } = useQuery({
    queryKey: ['group-data', sessionId, userData?.id, session?.has_active_round],
    queryFn: async () => {
      if (!userData?.id || !session?.has_active_round) return null;

      // First, get the current round to check its number
      const { data: currentRound, error: currentRoundError } = await supabase
        .from('ROUND')
        .select('*')
        .eq('id', session.has_active_round)
        .maybeSingle();

      if (currentRoundError) throw currentRoundError;
      
      // Only fetch group data for round 2 and above
      if (!currentRound || currentRound.round_number === 1) {
        return null;
      }

      console.log('Fetching group data for round:', currentRound.id);

      // First find all groups for this round
      const { data: roundGroups, error: roundGroupsError } = await supabase
        .from('ROUND_GROUPS')
        .select('groups_id')
        .eq('round_id', currentRound.id);

      if (roundGroupsError) {
        console.error('Error fetching round groups:', roundGroupsError);
        return null;
      }

      if (!roundGroups || roundGroups.length === 0) {
        console.log('No round groups found');
        return null;
      }

      console.log('Found round groups:', roundGroups);

      // Get all groups and find which one contains the current user
      const groupIds = roundGroups.map(rg => rg.groups_id);
      const { data: groups, error: groupsError } = await supabase
        .from('GROUPS')
        .select(`
          id,
          leader,
          group_members:GROUP_MEMBERS(member_id)
        `)
        .in('id', groupIds);

      if (groupsError) {
        console.error('Error fetching groups:', groupsError);
        return null;
      }

      if (!groups || groups.length === 0) {
        console.log('No groups found');
        return null;
      }

      // Find the group that contains the current user
      const userGroup = groups.find(group => 
        group.group_members.some(member => member.member_id === userData.id)
      );

      if (!userGroup) {
        console.log('User not found in any group');
        return null;
      }

      console.log('Found user group:', userGroup);

      const memberIds = userGroup.group_members.map(m => m.member_id).filter(Boolean);
      const { data: members, error: membersError } = await supabase
        .from('SESSION_USERS')
        .select('id, name')
        .in('id', memberIds);

      if (membersError) {
        console.error('Error fetching members:', membersError);
        return null;
      }

      return {
        isLeader: userGroup.leader === userData.id,
        groupMembers: members || []
      };
    },
    enabled: !!userData?.id && !!session?.has_active_round,
  });

  const {
    data: previousRoundAnswers,
    isLoading: isLoadingPreviousAnswers
  } = useQuery({
    queryKey: ['previous-round-answers', sessionId, currentRound?.round_number, groupData?.groupMembers],
    queryFn: async () => {
      if (!currentRound?.round_number || !groupData?.groupMembers) {
        return null;
      }

      // Only fetch previous round answers if we're in round 2 or higher
      if (currentRound.round_number <= 1) {
        return null;
      }

      // Get the previous round
      const { data: prevRound, error: prevRoundError } = await supabase
        .from('ROUND')
        .select('id')
        .eq('statement_id', currentRound.statement_id)
        .eq('round_number', currentRound.round_number - 1)
        .single();

      if (prevRoundError || !prevRound) {
        console.error('Error fetching previous round:', prevRoundError);
        return null;
      }

      console.log('Previous round:', prevRound);

      // Get answers from the previous round for all group members
      const memberIds = groupData.groupMembers.map(m => m.id);
      const { data: answers, error: answersError } = await supabase
        .from('ANSWER')
        .select(`
          agreement_level,
          confidence_level,
          comment,
          respondant_id
        `)
        .eq('round_id', prevRound.id)
        .in('respondant_id', memberIds);

      if (answersError) {
        console.error('Error fetching previous round answers:', answersError);
        return null;
      }

      console.log('Previous round answers:', answers);

      return answers.map(answer => {
        const member = groupData.groupMembers.find(m => m.id === answer.respondant_id);
        return {
          ...answer,
          respondant_name: member?.name || 'Unknown'
        };
      });
    },
    enabled: !!currentRound?.round_number && !!groupData?.groupMembers && currentRound.round_number > 1,
  });

  useEffect(() => {
    if (!sessionId) return;

    console.log('Setting up subscriptions for session:', sessionId);

    const sessionChannel = supabase
      .channel('session-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'SESSION',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          console.log('Session update received:', payload);
          window.location.reload();
        }
      )
      .subscribe();

    const roundChannel = supabase
      .channel('round-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ROUND',
          filter: `id=eq.${session?.has_active_round}`,
        },
        (payload) => {
          console.log('Round update received:', payload);
          window.location.reload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(roundChannel);
    };
  }, [sessionId, session?.has_active_round]);

  if (isLoadingSession || isLoadingUser || isLoadingRound || isLoadingAnswer || isLoadingGroup || isLoadingPreviousAnswers) {
    return (
      <div className="container mx-auto p-8">
        <div className="text-center text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-8">
        <div className="text-center text-red-500">Session not found</div>
      </div>
    );
  }

  if (session.status === 'UNPUBLISHED') {
    return (
      <div className="container mx-auto p-8">
        <div className="text-center text-yellow-500">
          This session is not currently active
        </div>
      </div>
    );
  }

  const getFormProps = (statement: Statement) => ({
    id: statement.id,
    content: statement.statement || '',
    status: 'STARTED',
    groupData: groupData || undefined
  });

  const renderContent = () => {
    console.log('Rendering content with:', {
      session,
      userData,
      currentRound,
      userAnswer,
      groupData,
      previousRoundAnswers
    });

    if (session.status === 'PUBLISHED' && !userData) {
      return <JoinSessionForm />;
    }

    if (session.status === 'STARTED') {
      if (!userData) {
        return (
          <div className="text-center text-red-500">
            You need to join the session first
          </div>
        );
      }

      if (!currentRound?.statement) {
        return (
          <div className="text-center text-gray-600">
            Waiting for the administrator to start a round...
          </div>
        );
      }

      return (
        <div className="space-y-8">
          {previousRoundAnswers && previousRoundAnswers.length > 0 && (
            <PreviousRoundAnswers 
              answers={previousRoundAnswers}
              statement={currentRound.statement.statement || ''}
            />
          )}
          
          {currentRound.status === 'STARTED' && !userAnswer ? (
            <UserResponseForm 
              statement={getFormProps(currentRound.statement)}
              onSubmit={() => {
                toast({
                  title: "Success",
                  description: "Your response has been submitted",
                });
                window.location.reload();
              }}
              groupData={groupData}
            />
          ) : (
            <WaitingPage />
          )}
        </div>
      );
    }

    return null;
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

      {currentRound?.round_number && session.status === 'STARTED' && (
        <p className="text-center text-muted-foreground mb-8">
          Round {currentRound.round_number}
        </p>
      )}
      
      <div className="mt-8">
        {renderContent()}
      </div>
    </div>
  );
};

export default UserPage;
