
import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionContext } from '@supabase/auth-helpers-react';

interface Session {
  id: number;
  name: string;
  status: string;
  created_at: string;
  users: Array<{ id: number; name: string }>;
}

interface SessionsTableProps {
  sessions: Session[];
}

export const SessionsTable = ({ sessions }: SessionsTableProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session: authSession } = useSessionContext();

  const handleDelete = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click from triggering

    try {
      console.log('Attempting to delete session:', sessionId);
      
      // With CASCADE deletion, we can now directly delete the session
      const { error: deleteSessionError } = await supabase
        .from('Sessions')
        .delete()
        .eq('id', sessionId);

      if (deleteSessionError) {
        console.error('Error deleting session:', deleteSessionError);
        throw deleteSessionError;
      }

      console.log('Successfully deleted session:', sessionId);
      
      // Invalidate the sessions query to refresh the list
      queryClient.invalidateQueries({ 
        queryKey: ['admin-sessions', authSession?.user?.id] 
      });

      toast({
        title: "Success",
        description: "Session deleted successfully",
      });
    } catch (error) {
      console.error('Failed to delete session:', error);
      toast({
        title: "Error",
        description: "Failed to delete session. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Session Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="min-w-[200px]">Participants</TableHead>
            <TableHead>Created At</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions?.map((session) => (
            <TableRow
              key={session.id}
              className="cursor-pointer"
              onClick={() => navigate(`/admin/session/${session.id}`)}
            >
              <TableCell className="font-medium">{session.name}</TableCell>
              <TableCell>
                <Badge variant={session.status === 'unpublished' ? 'secondary' : 'default'}>
                  {session.status}
                </Badge>
              </TableCell>
              <TableCell>
                {session.users && session.users.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {session.users.map((user) => (
                      <Badge 
                        key={user.id} 
                        variant="secondary"
                      >
                        {user.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">No participants yet</span>
                )}
              </TableCell>
              <TableCell>
                {new Date(session.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={(e) => handleDelete(session.id, e)}
                  className="w-8 h-8 p-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
