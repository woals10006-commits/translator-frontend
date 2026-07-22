import { useState, useRef } from 'react'
import './App.css'

function App() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [startChapter, setStartChapter] = useState('1')
  const [endChapter, setEndChapter] = useState('100')
  const [customPrompt, setCustomPrompt] = useState('')
  const [savedPath, setSavedPath] = useState('')

  // Keep only digits and strip any leading zeros so typing "020" shows "20".
  const cleanNum = (v) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const [progress, setProgress] = useState(0)
  const inputRef = useRef()
  const pollRef = useRef()

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

  const handleTranslate = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    setDone(false)
    setProgress(0)
    setSavedPath('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('customPrompt', customPrompt)

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

  return (
    <div className="container">
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
    </div>
  )
}

export default App
