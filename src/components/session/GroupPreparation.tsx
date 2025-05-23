
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Answer } from '@/types/answer';
import { Participant } from '@/types/participant';
import { Badge } from "@/components/ui/badge";
import { supabase } from '@/integrations/supabase/client';
import { useToast } from "@/hooks/use-toast";

interface GroupPreparationProps {
  participants: Participant[];
  answers: Answer[];
}

interface Group {
  id: number;
  members: Participant[];
  leader?: Participant;
}

export const GroupPreparation = ({ participants, answers }: GroupPreparationProps) => {
  const { toast } = useToast();
  const [savedGroups, setSavedGroups] = React.useState<Group[]>([]);

  const createGroups = async (participants: Participant[], answers: Answer[]) => {
    try {
      // Get session ID directly from the participants (they all belong to the same session)
      const sessionId = participants[0]?.session_id;
      if (!sessionId) {
        throw new Error('Could not determine session ID from participants');
      }

      // Get the active round ID from the session
      const { data: sessionData, error: sessionError } = await supabase
        .from('SESSION')
        .select('has_active_round')
        .eq('id', sessionId)
        .single();

      if (sessionError) throw sessionError;
      
      const activeRoundId = sessionData.has_active_round;
      if (!activeRoundId) {
        throw new Error('No active round found in session');
      }

      // Get current round info to check for next round
      const { data: currentRound, error: currentRoundError } = await supabase
        .from('ROUND')
        .select('round_number, statement_id')
        .eq('id', activeRoundId)
        .single();

      if (currentRoundError) throw currentRoundError;

      const nextRoundNumber = currentRound.round_number + 1;
      
      // Check if a round already exists for this round number
      const { data: existingRound, error: existingRoundError } = await supabase
        .from('ROUND')
        .select('*')
        .eq('statement_id', currentRound.statement_id)
        .eq('round_number', nextRoundNumber)
        .maybeSingle();

      if (existingRoundError) throw existingRoundError;

      let newRound;
      
      if (!existingRound) {
        // Create next round with NOT_STARTED status only if it doesn't exist
        const { data: createdRound, error: newRoundError } = await supabase
          .from('ROUND')
          .insert({
            statement_id: currentRound.statement_id,
            round_number: nextRoundNumber,
            status: 'NOT_STARTED',
            started_at: new Date().toISOString(),
            respondant_type: 'GROUP'
          })
          .select()
          .single();

        if (newRoundError) throw newRoundError;
        newRound = createdRound;

        // Update the session with the new round ID IMMEDIATELY
        const { error: sessionUpdateError } = await supabase
          .from('SESSION')
          .update({ has_active_round: newRound.id })
          .eq('id', sessionId);

        if (sessionUpdateError) throw sessionUpdateError;
      } else {
        // If we're using an existing round, ensure it has the correct status and respondant_type
        const { error: updateError } = await supabase
          .from('ROUND')
          .update({ 
            respondant_type: 'GROUP',
            status: 'NOT_STARTED'
          })
          .eq('id', existingRound.id);

        if (updateError) throw updateError;
        newRound = { ...existingRound, respondant_type: 'GROUP', status: 'NOT_STARTED' };
      }

      console.log('Creating groups for session:', sessionId, 'and round:', newRound.id);

      // Calculate number of groups needed (2-3 participants per group)
      const totalParticipants = participants.length;
      const numGroups = Math.ceil(totalParticipants / 3);
      
      const groups: Group[] = [];
      
      // Create initial empty groups
      for (let i = 0; i < numGroups; i++) {
        groups.push({ id: i + 1, members: [] });
      }

      // Distribute participants evenly across groups
      participants.forEach((participant, index) => {
        const groupIndex = index % groups.length;
        groups[groupIndex].members.push(participant);
      });

      // For each group, create database entries
      for (const group of groups) {
        if (group.members.length > 0) {
          // Randomly select a leader from the group members
          const leaderIndex = Math.floor(Math.random() * group.members.length);
          const leader = group.members[leaderIndex];
          
          // Create group in database
          const { data: groupData, error: groupError } = await supabase
            .from('GROUPS')
            .insert([{ leader: leader.id }])
            .select()
            .single();

          if (groupError) {
            console.error('Error creating group:', groupError);
            throw groupError;
          }

          console.log('Created group:', groupData);

          // Add members to group
          const memberPromises = group.members.map(member => 
            supabase
              .from('GROUP_MEMBERS')
              .insert([{
                member_id: member.id,
                member_type: 'SESSION_USER',
                parent_groups_id: groupData.id
              }])
          );

          const memberResults = await Promise.all(memberPromises);
          console.log('Added members to group:', memberResults);

          // Create round group association
          const { data: roundGroupData, error: roundGroupError } = await supabase
            .from('ROUND_GROUPS')
            .insert([{
              round_id: newRound.id,
              groups_id: groupData.id
            }])
            .select();

          if (roundGroupError) {
            console.error('Error creating round group association:', roundGroupError);
            throw roundGroupError;
          }

          console.log('Created round group association:', roundGroupData);

          // Update the group object with the database id and leader
          group.id = groupData.id;
          group.leader = leader;
        }
      }

      // Filter out empty groups and update state
      const finalGroups = groups.filter(group => group.members.length > 0);
      setSavedGroups(finalGroups);

      toast({
        title: "Success",
        description: "Groups have been created and saved",
      });

    } catch (error) {
      console.error('Error creating groups:', error);
      toast({
        title: "Error",
        description: "Failed to create groups",
        variant: "destructive",
      });
    }
  };

  // Create groups when component mounts
  React.useEffect(() => {
    if (participants.length > 0 && answers.length > 0) {
      createGroups(participants, answers);
    }
  }, [participants, answers]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discussion Groups</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {savedGroups.length > 0 ? (
            savedGroups.map((group, index) => (
              <Card key={group.id} className="p-4">
                <div className="font-medium mb-2">Group {index + 1}</div>
                <div className="space-y-2">
                  {group.members.map((member) => (
                    <div key={member.id} className="flex items-center gap-2">
                      <span>{member.name}</span>
                      {group.leader?.id === member.id && (
                        <Badge variant="secondary">Leader</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))
          ) : (
            <p className="text-muted-foreground">No groups have been formed yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
