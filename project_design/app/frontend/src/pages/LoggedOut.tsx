/**
 * LoggedOut.tsx - 로그아웃 완료 페이지
 * 
 * Synology SSO는 end_session_endpoint가 없어서
 * 로그아웃 후 /auth/login으로 바로 보내면 SSO 세션이 살아있어 자동 재로그인됨.
 * 이 페이지에서 사용자가 직접 "다시 로그인" 버튼을 눌러야 SSO로 이동.
 */
export default function LoggedOut() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 max-w-sm w-full text-center">
        {/* 아이콘 */}
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-slate-800 mb-2">로그아웃 되었습니다</h1>
        <p className="text-sm text-slate-400 mb-8">
          악티보 일정관리 시스템에서<br />안전하게 로그아웃 되었습니다.
        </p>

        <button
          onClick={() => { window.location.href = '/auth/login'; }}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          다시 로그인
        </button>

        <p className="text-xs text-slate-300 mt-4">
          Synology 계정으로 로그인합니다
        </p>
      </div>
    </div>
  );
}
