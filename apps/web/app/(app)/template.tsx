/** Her rota degisiminde yeniden baglanir → sayfa hafifce belirerek gelir. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
