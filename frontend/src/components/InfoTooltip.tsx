interface InfoTooltipProps {
  text: string
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <span className="relative group inline-flex items-center ml-1">
      <span className="w-3.5 h-3.5 rounded-full bg-zinc-700 text-zinc-400 text-[9px] font-bold flex items-center justify-center cursor-default select-none">
        i
      </span>
      <span className="
        pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        w-52 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700
        text-xs text-zinc-300 leading-relaxed shadow-xl
        opacity-0 group-hover:opacity-100 transition-opacity duration-150
      ">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-700" />
      </span>
    </span>
  )
}
