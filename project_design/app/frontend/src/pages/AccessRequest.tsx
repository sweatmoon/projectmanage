/**
 * AccessRequest.tsx - 권한 신청 페이지
 * 구글 로그인 후 허용 목록에 없는 사용자가 권한 신청하는 페이지
 */
import { useState, useEffect } from 'react';
import { Shield, Clock, CheckCircle, XCircle, Mail, MessageSquare } from 'lucide-react';

export default function AccessRequest() {
  const urlParams = new URLSearchParams(window.location.search);
  const statusParam = urlParams.get('status'); // submitted / pending / rejected
  const emailParam = urlParams.get('email') || '';
  const reasonParam = urlParams.get('reason') || '';

  const [currentStatus, setCurrentStatus] = useState(statusParam);
  const [rejectReason] = useState(decodeURIComponent(reasonParam));
  const [approved, setApproved] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // pending / submitted 상태면 3초마다 승인 여부 폴링
  useEffect(() => {
    if (!(statusParam === 'pending' || statusParam === 'submitted') || !emailParam) return;

    // 즉시 1회 체크
    checkStatus(emailParam);

    // 3초 간격 폴링
    const intervalId = setInterval(() => checkStatus(emailParam), 3000);
    return () => clearInterval(intervalId);
  }, []);

  // 승인됐을 때 카운트다운 후 자동 로그인
  useEffect(() => {
    if (!approved) return;
    if (countdown <= 0) {
      window.location.href = '/auth/login';
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [approved, countdown]);

  async function checkStatus(email: string) {
    try {
      const res = await fetch(`/auth/request-status?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (data.status === 'approved') {
        // 승인된 경우 → 카운트다운 후 재로그인 (새 JWT 발급)
        setApproved(true);
        return;
      }
      if (data.status === 'rejected') {
        setCurrentStatus('rejected');
      }
    } catch {
      // 무시
    }
  }

  function handleRetryLogin() {
    window.location.href = '/auth/login';
  }

  // ── 접근 거부 (아직 신청 전) ──────────────────────────────
  if (!statusParam || statusParam === 'denied') {
    return (
      <PageWrapper>
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <Shield className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">접근 권한이 없습니다</h1>
        <p className="text-sm text-slate-500 mb-6">
          이 서비스는 허가된 사용자만 이용할 수 있습니다.
        </p>
        <button
          onClick={handleRetryLogin}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors mb-3"
        >
          구글 계정으로 로그인 후 신청
        </button>
        <p className="text-xs text-slate-400">
          로그인하면 자동으로 접근 권한 신청이 등록됩니다.<br />
          관리자 승인 후 서비스를 이용할 수 있습니다.
        </p>
      </PageWrapper>
    );
  }

  // ── 승인 완료 (폴링으로 감지됨) ─────────────────────────
  if (approved) {
    return (
      <PageWrapper>
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">승인되었습니다! 🎉</h1>
        <p className="text-sm text-slate-600 mb-4">
          접근 권한이 승인되었습니다.<br />
          잠시 후 자동으로 로그인 페이지로 이동합니다.
        </p>
        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-xl font-bold text-blue-600">{countdown}</span>
        </div>
        <button
          onClick={() => { window.location.href = '/auth/login'; }}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          지금 로그인하기
        </button>
        <p className="text-xs text-slate-300 mt-4">악티보 일정관리 시스템</p>
      </PageWrapper>
    );
  }

  // ── 신청 완료 (새로 신청됨) ───────────────────────────────
  if (currentStatus === 'submitted') {
    return (
      <PageWrapper>
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">권한 신청 완료</h1>
        <p className="text-sm text-slate-600 mb-2">
          접근 권한 신청이 접수되었습니다.
        </p>
        {emailParam && (
          <div className="flex items-center justify-center gap-1.5 text-sm text-blue-600 mb-4">
            <Mail className="w-4 h-4" />
            <span className="font-medium">{emailParam}</span>
          </div>
        )}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-left">
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 mb-1">관리자 승인 대기 중</p>
              <p className="text-xs text-amber-700">
                관리자가 신청을 검토합니다. 승인 후 다시 로그인하면 서비스를 이용할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={handleRetryLogin}
          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 px-6 rounded-xl transition-colors text-sm"
        >
          승인 후 다시 로그인
        </button>
        <p className="text-xs text-slate-300 mt-4">악티보 일정관리 시스템</p>
      </PageWrapper>
    );
  }

  // ── 이미 신청 중 (pending 상태) ───────────────────────────
  if (currentStatus === 'pending') {
    return (
      <PageWrapper>
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <Clock className="w-8 h-8 text-yellow-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">승인 대기 중</h1>
        <p className="text-sm text-slate-500 mb-2">
          이미 접근 권한 신청이 접수되어 있습니다.
        </p>
        {emailParam && (
          <div className="flex items-center justify-center gap-1.5 text-sm text-blue-600 mb-4">
            <Mail className="w-4 h-4" />
            <span className="font-medium">{emailParam}</span>
          </div>
        )}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-left">
          <p className="text-sm text-blue-800">
            관리자가 신청을 검토 중입니다. <strong>승인되면 이 화면에서 자동으로 로그인 페이지로 이동</strong>합니다.
          </p>
        </div>
        <button
          onClick={handleRetryLogin}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors mb-2"
        >
          지금 다시 확인하기
        </button>
        <p className="text-xs text-slate-300 mt-4">악티보 일정관리 시스템</p>
      </PageWrapper>
    );
  }

  // ── 거부됨 (rejected 상태) ────────────────────────────────
  if (currentStatus === 'rejected') {
    return (
      <PageWrapper>
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <XCircle className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">접근 권한 거부</h1>
        <p className="text-sm text-slate-500 mb-4">
          권한 신청이 거부되었습니다.
        </p>
        {rejectReason && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-left">
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-red-700 mb-1">거부 사유</p>
                <p className="text-sm text-red-800">{rejectReason}</p>
              </div>
            </div>
          </div>
        )}
        <p className="text-xs text-slate-400 mb-6">
          접근 권한이 필요한 경우 관리자에게 직접 문의하세요.
        </p>
        <p className="text-xs text-slate-300">악티보 일정관리 시스템</p>
      </PageWrapper>
    );
  }

  // fallback
  return (
    <PageWrapper>
      <p className="text-sm text-slate-500">알 수 없는 상태입니다.</p>
      <button
        onClick={() => window.location.href = '/'}
        className="mt-4 text-sm text-blue-600 hover:underline"
      >
        홈으로 돌아가기
      </button>
    </PageWrapper>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 max-w-sm w-full text-center">
        {children}
      </div>
    </div>
  );
}
