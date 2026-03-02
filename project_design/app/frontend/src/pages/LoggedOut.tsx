/**
 * LoggedOut.tsx - 로그아웃 완료 / 접근 거부 페이지
 */
export default function LoggedOut() {
  const urlParams = new URLSearchParams(window.location.search);
  const reason = urlParams.get('reason');
  const isNotAllowed = reason === 'not_allowed';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 max-w-sm w-full text-center">
        {isNotAllowed ? (
          <>
            {/* 접근 거부 아이콘 */}
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">접근이 거부되었습니다</h1>
            <p className="text-sm text-slate-500 mb-2">
              이 서비스에 대한 접근 권한이 없습니다.
            </p>
            <p className="text-sm text-slate-400 mb-8">
              관리자에게 접근 권한 추가를 요청하세요.
            </p>
            <p className="text-xs text-slate-300 mt-4">
              악티보 일정관리 시스템
            </p>
          </>
        ) : (
          <>
            {/* 로그아웃 아이콘 */}
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
          </>
        )}
      </div>
    </div>
  );
}
