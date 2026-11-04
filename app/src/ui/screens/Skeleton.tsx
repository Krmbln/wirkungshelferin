import '../App.css'
import '../frame/Sidebar.css'
import '../frame/PageHeader.css'
import './Skeleton.css'

type Size = 's' | 'm' | 'l'

// Widths come from classes, not inline styles (CSP: style-src 'self').
const Bar = ({ size }: { size: Size }) => <span className={`skeleton__bar skeleton__bar--${size}`} />

const sidebarRows: Size[] = ['m', 'l', 's', 'm', 's', 'l', 'm']
const homeRows: Size[] = ['l', 'm', 'l', 's', 'm']

// While the project loads (design §6.2): the frame with grey rows, no spinner.
// Usually gone before anyone sees it.
export function Skeleton() {
  return (
    <div className="app" aria-busy="true">
      <p className="visually-hidden" role="status">
        Wird geladen …
      </p>
      <div className="sidebar skeleton__sidebar" aria-hidden="true">
        <Bar size="l" />
        {sidebarRows.map((size, i) => (
          <Bar key={i} size={size} />
        ))}
      </div>
      <div className="app__main" aria-hidden="true">
        <div className="page-header">
          <Bar size="s" />
        </div>
        <div className="skeleton__body">
          <div className="skeleton__card">
            <Bar size="s" />
            <Bar size="l" />
            <Bar size="m" />
          </div>
          {homeRows.map((size, i) => (
            <div key={i} className="skeleton__row">
              <Bar size={size} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
