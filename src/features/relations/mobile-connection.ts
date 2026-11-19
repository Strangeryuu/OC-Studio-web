/**
 * React Flow supports pointer/touch connections natively. On phones we
 * expose handle-based drag-to-connect and a two-tap fallback for accessibility.
 * This policy never grants edit access: role-based callbacks decide canConnect.
 */
export function graphConnectionBehavior(isMobile: boolean, canConnect: boolean) {
  return {
    nodesConnectable: canConnect,
    connectOnClick: isMobile && canConnect,
    connectionRadius: isMobile ? 64 : 48,
  }
}
