import { useState, useRef, useEffect } from 'react'
import './App.css'
import Proofread from './Proofread'
import IssueWords from './IssueWords'

// 앱 이름 — 여기 값만 바꾸면 화면 위쪽 제목이 바뀝니다.
const APP_NAME = '웹소설 도구'

const TABS = [
  { id: 'translate', label: '번역' },
  { id: 'issue', label: '이슈단어 찾기' },
  { id: 'proof', label: 'AI 교정교열' },
]

// 세 도구가 공유하는 겉틀. 도구를 고르는 시작 화면 대신 위쪽 탭으로 오가고,
// 본문은 어느 도구든 같은 폭·같은 여백 안에 들어간다.
function Shell({ view, go, children }) {
  return (
    <div className="app">
      <header className="app-head">
        <span className="app-name">{APP_NAME}</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${view === t.id ? 'active' : ''}`}
              onClick={() => go(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="container">{children}</div>
    </div>
  )
}

function App() {
  const [view, setView] = useState('translate')   // 'translate' | 'issue' | 'proof'
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [startChapter, setStartChapter] = useState('1')
  const [endChapter, setEndChapter] = useState('100')
  const [customPrompt, setCustomPrompt] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [choice, setChoice] = useState(null)  // 부분 번역 감지 시 팝업: {translated, untranslated}

  // Keep only digits and strip any leading zeros so typing "020" shows "20".
  const cleanNum = (v) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const [progress, setProgress] = useState(0)
  const inputRef = useRef()
  const pollRef = useRef()

  // Navigate between views AND push a browser-history entry, so the browser's
  // back button (and the ← 홈 button, which just calls history.back) returns
  // to the previous screen instead of doing nothing.
  const go = (v) => {
    window.history.pushState({ view: v }, '')
    setView(v)
  }
  useEffect(() => {
    const onPop = (e) => setView(e.state?.view ?? 'translate')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const handleFileChange = (e) => {
    const selected = e.target.files[0]
    if (selected && selected.name.endsWith('.docx')) {
      setFile(selected)
      setError('')
      setDone(false)
      setProgress(0)
    } else {
      setError('.docx 파일만 업로드 가능합니다.')
      setFile(null)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files[0]
    if (dropped && dropped.name.endsWith('.docx')) {
      setFile(dropped)
      setError('')
      setDone(false)
      setProgress(0)
    } else {
      setError('.docx 파일만 업로드 가능합니다.')
    }
  }

  // 번역 시작: 먼저 파일이 "일부만 번역된" 상태인지 검사.
  //  - 부분 번역이면 → 팝업으로 [처음부터] / [이어서 채우기] 선택
  //  - 신선한 원본(전부 원문)이면 → 팝업 없이 바로 번역
  const handleTranslate = async () => {
    if (!file) return
    try {
      const fd = new FormData()
      fd.append('file', file)
      const info = await fetch('http://localhost:8080/api/inspect', { method: 'POST', body: fd }).then(r => r.json())
      if (info.partial) {
        setChoice(info)   // 팝업 띄우기
        return
      }
      startTranslation(false)
    } catch (e) {
      // 검사 실패 시 그냥 일반 번역으로 진행
      startTranslation(false)
    }
  }

  const startTranslation = async (fillMode) => {
    if (!file) return
    setChoice(null)
    setLoading(true)
    setError('')
    setDone(false)
    setProgress(0)
    setSavedPath('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('customPrompt', customPrompt)
      formData.append('fillMode', fillMode)

      const start = parseInt(startChapter, 10) || 1
      const end = parseInt(endChapter, 10) || start
      const res = await fetch(`http://localhost:8080/api/translate?startChapter=${start}&endChapter=${end}`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error('업로드 실패')
      const { jobId } = await res.json()

      pollRef.current = setInterval(async () => {
        try {
          const prog = await fetch(`http://localhost:8080/api/progress/${jobId}`).then(r => r.json())
          setProgress(prog.progress)

          if (prog.done) {
            clearInterval(pollRef.current)

            if (prog.error) {
              setError(`오류 발생: ${prog.error}`)
              setLoading(false)
              return
            }

            // The backend saves the finished file to disk itself (the reliable
            // path that survives a closed tab), so we do NOT trigger a second,
            // less-reliable browser download — just show where the file landed.
            setSavedPath(prog.savedPath || '')
            setDone(true)
            setLoading(false)

            if (prog.errorCount > 0) {
              alert(`번역 완료! 단, ${prog.errorCount}개 단락은 오류로 원문이 유지되었습니다.`)
            }
          }
        } catch (e) {
          clearInterval(pollRef.current)
          setError('진행 상황 확인 중 오류가 발생했습니다.')
          setLoading(false)
        }
      }, 1500)

    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  // ===== AI 교정교열 =====
  if (view === 'proof') {
    return <Shell view={view} go={go}><Proofread /></Shell>
  }

  // ===== 이슈단어 찾기 =====
  if (view === 'issue') {
    return <Shell view={view} go={go}><IssueWords /></Shell>
  }

  // ===== 번역기 =====
  return (
    <Shell view={view} go={go}>
      <h1>중국어 → 한국어 번역기</h1>
      <p className="subtitle">Word(.docx) 파일을 업로드하면 번역된 파일을 받을 수 있습니다.</p>

      <div
        className={`dropzone ${file ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !loading && inputRef.current.click()}
      >
        <input
          type="file"
          accept=".docx"
          ref={inputRef}
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        {file ? (
          <div className="file-info">
            <span className="file-icon">📄</span>
            <span className="file-name">{file.name}</span>
          </div>
        ) : (
          <div className="drop-hint">
            <div className="upload-icon">↑</div>
            <p>클릭하거나 파일을 드래그하세요</p>
            <p className="small">.docx 파일만 지원</p>
          </div>
        )}
      </div>

      <div className="chapter-input">
        <label>번역 범위</label>
        <input
          type="text"
          inputMode="numeric"
          value={startChapter}
          onChange={(e) => setStartChapter(cleanNum(e.target.value))}
          disabled={loading}
        />
        <span>화 ~</span>
        <input
          type="text"
          inputMode="numeric"
          value={endChapter}
          onChange={(e) => setEndChapter(cleanNum(e.target.value))}
          disabled={loading}
        />
        <span>화</span>
      </div>

      <div className="custom-prompt">
        <label htmlFor="customPrompt">번역 요청사항 <span className="optional">(선택 · 매번 다르게 입력 가능)</span></label>
        <textarea
          id="customPrompt"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          disabled={loading}
          rows={4}
          placeholder={"예) 주인공 이름은 '린위'로 통일해줘\n예) 대사는 반말, 서술은 문어체로\n예) '师父'는 '사부님'으로 번역\n예) 전체적으로 담백하고 건조한 문체로"}
        />
      </div>

      {loading && (
        <div className="progress-wrap">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="progress-text">{progress}% 번역 중...</p>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {done && (
        <div className="success">
          <p>번역 완료! 파일이 저장되었습니다.</p>
          {savedPath && (
            <p className="saved-path">
              저장 위치 (이 파일 하나만 생성됩니다):<br />
              <code>{savedPath}</code>
            </p>
          )}
        </div>
      )}

      <button
        className="translate-btn"
        onClick={handleTranslate}
        disabled={!file || loading}
      >
        {loading ? `번역 중... ${progress}%` : '번역 시작'}
      </button>

      {choice && (
        <div className="modal-overlay" onClick={() => setChoice(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>이미 일부 번역된 파일이에요</h3>
            <p className="modal-stat">번역됨 <b>{choice.translated}</b>문단 · 남은 원문 <b>{choice.untranslated}</b>문단</p>
            <p className="modal-sub">처음부터 다시 할까요, 남은 부분만 이어서 채울까요?</p>
            <div className="modal-btns">
              <button className="modal-fill" onClick={() => startTranslation(true)}>
                이어서 채우기<span className="modal-hint">남은 원문만 (빠르고 저렴)</span>
              </button>
              <button className="modal-restart" onClick={() => startTranslation(false)}>
                처음부터 다시<span className="modal-hint">범위 전체를 새로</span>
              </button>
              <button className="modal-cancel" onClick={() => setChoice(null)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

export default App
