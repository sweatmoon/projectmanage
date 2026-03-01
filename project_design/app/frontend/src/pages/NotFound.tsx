import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-slate-300">404</h1>
        <p className="text-muted-foreground">페이지를 찾을 수 없습니다.</p>
        <Button onClick={() => navigate('/')}>
          <Home className="h-4 w-4 mr-1" />
          홈으로 돌아가기
        </Button>
      </div>
    </div>
  );
}