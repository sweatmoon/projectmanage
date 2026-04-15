import { useNavigate } from 'react-router-dom'
import { authStore, client } from '@/lib/api'
import { LogOut, User, Shield } from 'lucide-react'

export default function Header() {
  const navigate = useNavigate()
  const user = authStore.getUser()
  const isLoggedIn = authStore.isLoggedIn()
  const isAdmin = user?.role === 'admin'

  const handleLogout = () => {
    client.auth.logout()
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 flex items-center justify-between h-12 sm:h-14 gap-2">
        {/* 로고 + 타이틀 */}
        <button
          onClick={() => navigate('/?tab=home')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
        >
          <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          {/* 모바일: 축약, 데스크탑: 전체 */}
          <span className="font-bold text-gray-900 text-sm sm:text-base truncate">
            <span className="sm:hidden">악티보</span>
            <span className="hidden sm:inline">악티보 일정관리 시스템</span>
          </span>
        </button>

        {/* 사용자 정보 + 관리자 + 로그아웃 */}
        {isLoggedIn && (
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            {/* 유저명: sm 이상에서만 표시 */}
            <div className="hidden sm:flex items-center gap-1.5 text-sm text-gray-600">
              <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="font-medium truncate max-w-[120px]">{user?.name || user?.email || '사용자'}</span>
              {isAdmin && (
                <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded font-medium whitespace-nowrap">관리자</span>
              )}
            </div>
            {/* 관리자 버튼 */}
            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 transition-colors px-1.5 sm:px-2 py-1 rounded hover:bg-purple-50"
                title="관리자 페이지"
              >
                <Shield className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="hidden sm:inline">관리</span>
              </button>
            )}
            {/* 로그아웃 버튼 */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition-colors px-1.5 sm:px-2 py-1 rounded hover:bg-red-50"
              title="로그아웃"
            >
              <LogOut className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">로그아웃</span>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
