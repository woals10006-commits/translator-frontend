import { useState, useRef } from 'react'

/**
 * 이슈단어(유사언어) 찾기.
 *
 * 원래는 별도 HTML 을 iframe 으로 띄웠는데, 그러면 앱 안에서 혼자 다른 페이지처럼
 * 보였다. 번역·교정교열과 같은 화면 부품을 쓰도록 옮겨 온 것이다. 검사 방식은
 * 그대로다 — 서버를 거치지 않고 브라우저 안에서만 처리한다.
 */
export default function IssueWords() {
  const [txtFile, setTxtFile] = useState(null)
  const [docFile, setDocFile] = useState(null)
  const [results, setResults] = useState([])
  const [wordCount, setWordCount] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const txtRef = useRef()
  const docRef = useRef()

  const pick = (file, ext, setter) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith(ext)) {
      setError(`${ext} 파일만 넣을 수 있어요.`)
      return
    }
    setError('')
    setter(file)
  }

  // ---- 이슈단어(txt) 읽기: UTF-8 우선, 깨지면 EUC-KR로 재시도 ----
  const readIssueWords = async (file) => {
    const buf = await file.arrayBuffer()
    let text = new TextDecoder('utf-8').decode(buf)
    if (text.includes('�')) {
      try { text = new TextDecoder('euc-kr').decode(buf) } catch { /* 그대로 둔다 */ }
    }
    const words = text.split(/[\r\n,]+/).map((w) => w.trim()).filter((w) => w.length > 0)
    return [...new Set(words)]
  }

  // ---- 원고(docx) 읽기: 외부 라이브러리 없이 브라우저 내장 기능으로 압축 해제 ----
  const readManuscript = async (file) => {
    const buf = await file.arrayBuffer()
    const view = new DataView(buf)
    const bytes = new Uint8Array(buf)

    // ZIP의 EOCD(끝 표식) 찾기
    let eocd = -1
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) throw new Error('올바른 .docx(zip) 파일이 아닙니다.')

    const cdCount = view.getUint16(eocd + 10, true)
    let p = view.getUint32(eocd + 16, true)
    let target = null
    for (let i = 0; i < cdCount; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) break
      const method = view.getUint16(p + 10, true)
      const compSize = view.getUint32(p + 20, true)
      const nameLen = view.getUint16(p + 28, true)
      const extraLen = view.getUint16(p + 30, true)
      const commentLen = view.getUint16(p + 32, true)
      const localOffset = view.getUint32(p + 42, true)
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
      if (name === 'word/document.xml') { target = { method, compSize, localOffset }; break }
      p += 46 + nameLen + extraLen + commentLen
    }
    if (!target) throw new Error('원고 본문(document.xml)을 찾지 못했습니다.')

    const lo = target.localOffset
    const dataStart = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true)
    const compData = bytes.subarray(dataStart, dataStart + target.compSize)

    let xmlBytes
    if (target.method === 0) {
      xmlBytes = compData                      // 압축 안 됨
    } else {
      const ds = new DecompressionStream('deflate-raw')
      const stream = new Response(compData).body.pipeThrough(ds)
      xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer())
    }
    const xml = new TextDecoder('utf-8').decode(xmlBytes)

    // 문단/줄바꿈을 살리고 태그 제거
    const text = xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<[^>]+>/g, '')
    return decodeXmlEntities(text)
  }

  const decodeXmlEntities = (s) =>
    s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&')

  const countOccurrences = (text, word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = text.match(new RegExp(escaped, 'gi'))
    return matches ? matches.length : 0
  }

  const run = async () => {
    setError('')
    setLoading(true)
    try {
      const [issueWords, text] = await Promise.all([
        readIssueWords(txtFile),
        readManuscript(docFile),
      ])
      if (issueWords.length === 0) {
        throw new Error('이슈단어 목록이 비어 있습니다. txt 파일 내용을 확인해주세요.')
      }
      setWordCount(issueWords.length)
      setResults(
        issueWords
          .map((word) => ({ word, count: countOccurrences(text, word) }))
          .sort((a, b) => b.count - a.count)
      )
    } catch (err) {
      setError('오류: ' + (err && err.message ? err.message : err))
    } finally {
      setLoading(false)
    }
  }

  const rows = results.filter((r) => showAll || r.count > 0)
  const foundCount = results.filter((r) => r.count > 0).length

  const dropzone = (file, ext, hint, ref, setter) => (
    <div
      className={`dropzone ${file ? 'has-file' : ''}`}
      onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0], ext, setter) }}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => !loading && ref.current.click()}
    >
      <input
        type="file"
        accept={ext}
        ref={ref}
        onChange={(e) => pick(e.target.files[0], ext, setter)}
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
          <p className="small">{hint}</p>
        </div>
      )}
    </div>
  )

  return (
    <>
      <h1>이슈단어 찾기</h1>
      <p className="subtitle">이슈단어 목록(.txt)과 원고(.docx)를 넣으면, 원고에 들어 있는 이슈단어와 횟수를 알려줍니다.</p>

      <div className="field">
        <label>1. 이슈단어 목록 (.txt)</label>
        {dropzone(txtFile, '.txt', '한 줄에 단어 하나 (또는 쉼표로 구분)', txtRef, setTxtFile)}
      </div>

      <div className="field">
        <label>2. 원고 (.docx)</label>
        {dropzone(docFile, '.docx', '.docx 파일만 지원', docRef, setDocFile)}
      </div>

      {error && <p className="error">{error}</p>}

      <button className="translate-btn" disabled={!txtFile || !docFile || loading} onClick={run}>
        {loading ? '분석 중...' : '이슈단어 찾기'}
      </button>

      {results.length > 0 && (
        <div className="field result-field">
          <label>
            결과
            <span className="optional">이슈단어 {wordCount}개 중 {foundCount}개가 원고에 있음</span>
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            원고에 없는 단어도 보기
          </label>
          <table className="result-table">
            <thead>
              <tr><th>이슈단어</th><th className="num">나온 횟수</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={2} className="none">표시할 단어가 없습니다.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.word}>
                    <td>{r.word}</td>
                    <td className="num">
                      {r.count > 0
                        ? <span className="badge">{r.count}</span>
                        : <span className="zero">0</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
