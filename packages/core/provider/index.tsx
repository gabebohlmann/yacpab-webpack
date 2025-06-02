// packages/core/provider/index.tsx
import { SafeArea } from './safe-area'
import { NavigationProvider } from './navigation'

export function Provider({ children }: { children: React.ReactNode }) {
  return (
    <SafeArea>
      <NavigationProvider>{children}</NavigationProvider>
    </SafeArea>
  )
}
