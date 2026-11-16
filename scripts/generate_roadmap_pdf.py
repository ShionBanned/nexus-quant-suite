# scripts/generate_roadmap_pdf.py
# Generador Profesional de PDF: NEXUS QUANT SUITE v3.0 - HOJA DE RUTA INSTITUCIONAL

import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_footer(num_pages)
            super().showPage()
        super().save()

    def draw_header_footer(self, page_count):
        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header (en páginas posteriores a la portada)
        if self._pageNumber > 1:
            self.drawString(54, 750, "NEXUS QUANT SUITE v3.0 — HOJA DE RUTA INSTITUCIONAL (ESCALA MULTIMILLONARIA)")
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(54, 742, 558, 742)
        
        # Footer
        self.setFont("Helvetica", 8)
        self.drawString(54, 35, "CONFIDENCIAL & EXCLUSIVO — PROPIEDAD DE SHION & NEXUS QUANT")
        page_str = f"Página {self._pageNumber} de {page_count}"
        self.drawRightString(558, 35, page_str)
        self.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(54, 47, 558, 47)
        self.restoreState()

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()

    # Colores corporativos de la suite
    primary = colors.HexColor("#0F172A")    # Slate 900
    accent = colors.HexColor("#0284C7")     # Sky 600
    emerald = colors.HexColor("#059669")    # Emerald 600
    amber = colors.HexColor("#D97706")      # Amber 600
    dark_text = colors.HexColor("#1E293B")  # Slate 800
    sub_text = colors.HexColor("#475569")   # Slate 600
    bg_light = colors.HexColor("#F8FAFC")   # Slate 50
    border_color = colors.HexColor("#E2E8F0")

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=primary,
        spaceAfter=6
    )

    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=accent,
        spaceAfter=15
    )

    h1_style = ParagraphStyle(
        'Header1',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=15,
        leading=19,
        textColor=primary,
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Header2',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=accent,
        spaceBefore=10,
        spaceAfter=6,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'BodyDark',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=dark_text,
        spaceAfter=6
    )

    bullet_style = ParagraphStyle(
        'BulletText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=dark_text,
        leftIndent=14,
        spaceAfter=4
    )

    callout_style = ParagraphStyle(
        'CalloutText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=primary,
    )

    code_style = ParagraphStyle(
        'CodeSnippet',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=8,
        leading=10.5,
        textColor=colors.HexColor("#0F172A")
    )

    story = []

    # =========================================================================
    # PORTADA / HEADER DEL DOCUMENTO
    # =========================================================================
    story.append(Paragraph("NEXUS QUANT SUITE v3.0", subtitle_style))
    story.append(Paragraph("HOJA DE RUTA INSTITUCIONAL: ARQUITECTURA DE ESCALA MULTIMILLONARIA", title_style))
    story.append(Paragraph("Especificación Técnica y Plan Maestro para Futura Implementación (Pilares D, E y F)", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=accent, spaceBefore=4, spaceAfter=12))

    # Tarjeta de Metadatos
    meta_data = [
        [
            Paragraph("<b>Arquitectura Base:</b> Nexus v3.0 (Triádica)", body_style),
            Paragraph("<b>Estatus Actual:</b> Operativo en SHADOW (50 trades, PF: 3.22)", body_style)
        ],
        [
            Paragraph("<b>Autor & Operador:</b> Shion", body_style),
            Paragraph("<b>Fecha de Emisión:</b> Noviembre 2026", body_style)
        ],
        [
            Paragraph("<b>Objetivo de Escala:</b> $100,000 USD → $1,000,000+ USD", body_style),
            Paragraph("<b>Protocolo de Auditoría:</b> Argon N2 / EGM Goldfish", body_style)
        ]
    ]
    meta_table = Table(meta_data, colWidths=[250, 254])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_light),
        ('BOX', (0, 0), (-1, -1), 0.5, border_color),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, border_color),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 1: DIAGNÓSTICO Y LA NECESIDAD DE ESCALA
    # =========================================================================
    story.append(Paragraph("1. Diagnóstico de la Suite Actual y el Problema de la Escala", h1_style))
    story.append(Paragraph(
        "La arquitectura triádica v3.0 en producción ha resuelto exitosamente el 85% de la ingeniería de preservación y "
        "generación de capital mediante tres pilares operativos: <b>Sentinel v3.0</b> (rastreo de ballenas y entradas Fibonacci 38.2%), "
        "<b>Catalyst v2.0</b> (arbitraje sub-segundo con órdenes IOC) y <b>Aether</b> (bóveda Delta-Neutral de $70,000 USD cosechando funding rate al ~19.5% APR). "
        "Sin embargo, a medida que el patrimonio bajo gestión (AUM) escala de <b>$100,000 USD a $1,000,000+ USD</b>, surgen tres cuellos de botella inevitables:",
        body_style
    ))

    story.append(Paragraph("• <b>Vulnerabilidad de Hot-Wallets:</b> Acumular cientos de miles de dólares en billeteras activas conectadas al servidor incrementa exponencialmente el riesgo operativo y de smart contracts.", bullet_style))
    story.append(Paragraph("• <b>Depredación MEV y Fugas de Información:</b> Órdenes de gran notional ($30k - $80k USD) en la mempool pública de Solana son inmediatamente atacadas mediante <i>Sandwich Attacks</i> y copiado agresivo por bots externos.", bullet_style))
    story.append(Paragraph("• <b>Límites de Absorción en un solo DEX:</b> La profundidad de libro de un solo par en Raydium o Orca no permite salir de posiciones grandes sin sufrir deslizamiento (slippage) sustancial.", bullet_style))
    story.append(Paragraph(
        "Para superar estas barreras y operar al nivel de firmas cuantitativas como Wintermute o Citadel, se diseñan los <b>Pilares D, E y F</b>.",
        body_style
    ))
    story.append(Spacer(1, 10))

    # =========================================================================
    # SECCIÓN 2: PILAR D - BÓVEDA DE COSECHA FRÍA (COLD STORAGE AUTO-SWEEPER)
    # =========================================================================
    story.append(Paragraph("2. PILAR D: Bóveda de Cosecha Fría (Cold Storage Auto-Sweeper)", h1_style))
    story.append(Paragraph(
        "<b>Propósito:</b> Consolidar las ganancias en el mundo real, desacoplando el beneficio acumulado del riesgo de la red y garantizando que el capital de trabajo de los socios quede blindado en almacenamiento en frío (Hardware Ledger / Safe Multisig).",
        body_style
    ))

    story.append(Paragraph("A. Lógica Matemática del Barrido por High-Water Mark (HWM):", h2_style))
    story.append(Paragraph(
        "El módulo monitorea el patrimonio total líquido del sistema. Cada vez que las ganancias netas acumuladas superen el <b>High-Water Mark histórico en un umbral predefinido (ej. +15% o +$15,000 USD)</b>, se activa una época de barrido atómico:",
        body_style
    ))
    story.append(Paragraph("• <b>Capital Base Protegido:</b> Los $100,000 USD originales (incluyendo los $70,000 USD de Aether) jamás se tocan.", bullet_style))
    story.append(Paragraph("• <b>Regla 80/20 de Asignación de Excedentes:</b> El 80% del beneficio ($12,000 USD) se transfiere automáticamente a billeteras frías. El 20% restante ($3,000 USD) se capitaliza en la bóveda Aether para permitir crecimiento orgánico por interés compuesto.", bullet_style))
    story.append(Paragraph("• <b>Diversificación en Frío:</b> 60% se guarda en stablecoins de grado bancario (USDC nativo en red segura) y 40% en reservas spot de Bitcoin / Solana en custodia fría a largo plazo.", bullet_style))

    # Caja de Código / Pseudocódigo de Implementación
    code_box = [
        [Paragraph("<b>Especificación Técnica del Módulo (TypeScript / Node.js):</b>", callout_style)],
        [Paragraph(
            "// src/core/treasury_cold_sweeper.ts<br/>"
            "export class TreasuryColdSweeper {<br/>"
            "&nbsp;&nbsp;public evaluateSweepTrigger(equityMicro: bigint, hwmMicro: bigint): SweepPlan | null {<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;const thresholdMicro = (hwmMicro * 11500n) / 10000n; // +15% HWM<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;if (equityMicro &lt; thresholdMicro) return null;<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;const surplusMicro = equityMicro - hwmMicro;<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;const sweepAmountMicro = (surplusMicro * 8000n) / 10000n; // 80% hacia frío<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;return { sweepAmountMicro, coldVaultAddress: COLD_STORAGE_MULTISIG_ADDR };<br/>"
            "&nbsp;&nbsp;}<br/>"
            "}", code_style)]
    ]
    sweeper_table = Table(code_box, colWidths=[504])
    sweeper_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ('PADDING', (0, 0), (-1, -1), 7),
    ]))
    story.append(sweeper_table)
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 3: PILAR E - RUTEO PRIVADO ANTI-MEV (JITO BUNDLES)
    # =========================================================================
    story.append(Paragraph("3. PILAR E: Ruteo Privado Anti-MEV & Invisibilidad Cuántica (Jito Bundles)", h1_style))
    story.append(Paragraph(
        "<b>Propósito:</b> Eliminar completamente el riesgo de ataques de sándwich (MEV Front-Running) y neutralizar a los bots rastreadores cuando las órdenes individuales escalan a $20,000 – $80,000 USD por posición.",
        body_style
    ))

    story.append(Paragraph("A. Arquitectura Técnica de Inclusión Atómica sin Mempool:", h2_style))
    story.append(Paragraph(
        "En lugar de propagar las transacciones por los servidores RPC convencionales donde cualquier bot espía puede leerlas, "
        "el motor se conecta directamente al <b>Jito Block Engine</b>:",
        body_style
    ))
    story.append(Paragraph("• <b>Paquetes Atómicos Privados (Bundles):</b> Se agrupan hasta 5 transacciones (orden de entrada + orden de protección) y se envían de forma privada y cifrada al validador que lidera el bloque actual.", bullet_style))
    story.append(Paragraph("• <b>Jito Dynamic Tipping:</b> El sistema calcula una propina algorítmica en SOL (ej. 10 a 25 bps del beneficio proyectado) para garantizar que el validador incluya el paquete en el inicio del bloque sin subasta pública.", bullet_style))
    story.append(Paragraph("• <b>Fragmentación Procedural (Smart TWAP/VWAP):</b> Si la orden requerida supera los $25,000 USD, se fragmenta automáticamente en 5 micro-lotes de $5,000 USD intercalados en sub-bloques de 400 milisegundos.", bullet_style))

    # Tabla comparativa de impacto MEV
    mev_table_data = [
        [Paragraph("<b>Mecanismo de Ejecución</b>", callout_style), Paragraph("<b>Ruta Estándar (Pública)</b>", callout_style), Paragraph("<b>Pilar E: Jito Bundle Privado</b>", callout_style)],
        [Paragraph("Visibilidad en Mempool", body_style), Paragraph("Pública (100% visible a bots)", body_style), Paragraph("<b>100% Oculta y Cifrada</b>", body_style)],
        [Paragraph("Vulnerabilidad a Sandwich", body_style), Paragraph("Alta (pérdidas del 1% al 3%)", body_style), Paragraph("<b>Cero (Garantía Atómica)</b>", body_style)],
        [Paragraph("Copiado por Seguidores", body_style), Paragraph("Inmediato (en el mismo bloque)", body_style), Paragraph("<b>Imposible (se enteran post-bloque)</b>", body_style)],
        [Paragraph("Tasa de Éxito de Inclusión", body_style), Paragraph("Variable (caídas por congestión)", body_style), Paragraph("<b>99.4% (Prioridad Institucional)</b>", body_style)]
    ]
    mev_table = Table(mev_table_data, colWidths=[168, 168, 168])
    mev_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), primary),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('BACKGROUND', (0, 1), (-1, 1), colors.white),
        ('BACKGROUND', (0, 2), (-1, 2), bg_light),
        ('BACKGROUND', (0, 3), (-1, 3), colors.white),
        ('BACKGROUND', (0, 4), (-1, 4), bg_light),
        ('PADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(mev_table)
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 4: PILAR F - ARBITRAJE CRUZADO CEX / DEX (CROSS-VENUE)
    # =========================================================================
    story.append(Paragraph("4. PILAR F: Arbitraje Cruzado CEX / DEX (Cross-Venue Arbitrage)", h1_style))
    story.append(Paragraph(
        "<b>Propósito:</b> Extraer beneficios puros sin riesgo direccional explotando discrepancias de precio en microsegundos entre exchanges descentralizados de Solana (Raydium, Orca, Phoenix) y exchanges centralizados líderes (Binance, Bybit, OKX).",
        body_style
    ))

    story.append(Paragraph("A. Mecánica del Modelo Pre-Fondeado (Pre-Funded Inventory):", h2_style))
    story.append(Paragraph(
        "El mayor error de los principiantes al intentar arbitraje es transferir monedas entre exchanges durante la operación. "
        "En finanzas cuantitativas, la transferencia física es demasiado lenta. El Pilar F opera con <b>inventario pre-fondeado en ambos extremos</b>:",
        body_style
    ))
    story.append(Paragraph("• <b>Distribución de Tesorería:</b> $50,000 USD en colateral dentro de Binance/Bybit y $50,000 USD en contratos de Solana DEX.", bullet_style))
    story.append(Paragraph("• <b>Gatillo de Arbitraje:</b> Si SOL cotiza a $180.00 USD en Raydium y a $180.50 USD en Binance (diferencial &gt; 25 bps):", bullet_style))
    story.append(Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;1. Compra simultánea de 100 SOL en Raydium al precio de $180.00.", bullet_style))
    story.append(Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;2. Venta corta instantánea de 100 SOL en Binance al precio de $180.50.", bullet_style))
    story.append(Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;3. <b>Beneficio Neto:</b> $50.00 USD asegurados al milisegundo, completamente inmunes a si el mercado sube o colapsa después.", bullet_style))
    story.append(Paragraph("• <b>Épocas de Rebalanceo Inteligente:</b> Solo una vez al día, o cuando una de las cuentas supere el 65% de desbalance, un algoritmo nocturno transfiere fondos para nivelar los inventarios de forma segura.", bullet_style))
    story.append(Spacer(1, 12))

    # =========================================================================
    # SECCIÓN 5: INFRAESTRUCTURA FÍSICA DE GRADO INSTITUCIONAL
    # =========================================================================
    story.append(Paragraph("5. Infraestructura Física de Grado Institucional (El Salto a Producción)", h1_style))
    story.append(Paragraph(
        "Para competir en las grandes ligas, el software debe montarse sobre un entorno físico de latencia ultra-baja y alta disponibilidad:",
        body_style
    ))

    infra_items = [
        [Paragraph("<b>Componente</b>", callout_style), Paragraph("<b>Entorno Actual (Fase 1 Local)</b>", callout_style), Paragraph("<b>Entorno Institucional (Fase 2 / Millón)</b>", callout_style)],
        [Paragraph("Conexión Blockchain", body_style), Paragraph("RPC Compartido / WebSocket Estándar", body_style), Paragraph("<b>Nodo Dedicado gRPC Geyser (Triton / Helius)</b>", body_style)],
        [Paragraph("Geolocalización", body_style), Paragraph("PC Residencial Windows (Latencia ~60ms)", body_style), Paragraph("<b>Servidor Bare-Metal en Frankfurt / Salt Lake City (~2ms)</b>", body_style)],
        [Paragraph("Seguridad de Llaves", body_style), Paragraph("Variables de entorno cifradas locales", body_style), Paragraph("<b>Hardware Security Module (AWS KMS / Vault HSM)</b>", body_style)],
        [Paragraph("Estructura de Billeteras", body_style), Paragraph("Pool rotativo de 50 billeteras visibles", body_style), Paragraph("<b>Stealth Wallets efímeras con fondeo desvinculado</b>", body_style)]
    ]
    infra_table = Table(infra_items, colWidths=[130, 187, 187])
    infra_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), primary),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('BACKGROUND', (0, 1), (-1, 1), colors.white),
        ('BACKGROUND', (0, 2), (-1, 2), bg_light),
        ('BACKGROUND', (0, 3), (-1, 3), colors.white),
        ('BACKGROUND', (0, 4), (-1, 4), bg_light),
        ('PADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(infra_table)
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 6: MATRIZ Y CRONOGRAMA DE IMPLEMENTACIÓN POR CAPITAL
    # =========================================================================
    story.append(Paragraph("6. Plan Maestro de Despliegue por Hitos de Capital", h1_style))
    story.append(Paragraph(
        "No se deben implementar todos los módulos al mismo tiempo. La regla cuantitativa es **escalar la complejidad al ritmo exacto que crece el patrimonio**:",
        body_style
    ))

    roadmap_data = [
        [Paragraph("<b>Nivel</b>", callout_style), Paragraph("<b>Capital (AUM)</b>", callout_style), Paragraph("<b>Pilares Activos</b>", callout_style), Paragraph("<b>Prioridad de Desarrollo</b>", callout_style)],
        [
            Paragraph("<b>Fase 1</b><br/>(Actual)", body_style),
            Paragraph("$100,000 USD", body_style),
            Paragraph("Sentinel + Catalyst + Aether (Suite v3.0)", body_style),
            Paragraph("<b>Validar consistencia y acumular historial en SHADOW.</b>", body_style)
        ],
        [
            Paragraph("<b>Fase 2</b>", body_style),
            Paragraph("$100k a $250k", body_style),
            Paragraph("Suite v3.0 + <b>Pilar D (Cold Sweeper)</b>", body_style),
            Paragraph("Proteger ganancias netas en billeteras frías Ledger Multisig.", body_style)
        ],
        [
            Paragraph("<b>Fase 3</b>", body_style),
            Paragraph("$250k a $500k", body_style),
            Paragraph("Suite + Pilar D + <b>Pilar E (Jito Bundles)</b>", body_style),
            Paragraph("Activar nodo gRPC dedicado y ruteo privado para neutralizar MEV.", body_style)
        ],
        [
            Paragraph("<b>Fase 4</b>", body_style),
            Paragraph("$500k a $1M+", body_style),
            Paragraph("Suite Completa + <b>Pilar F (Cross-Venue)</b>", body_style),
            Paragraph("Desplegar tesorería en Binance/Bybit para arbitraje CEX/DEX institucional.", body_style)
        ]
    ]
    roadmap_table = Table(roadmap_data, colWidths=[65, 95, 180, 164])
    roadmap_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), accent),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('BACKGROUND', (0, 1), (-1, 1), colors.white),
        ('BACKGROUND', (0, 2), (-1, 2), bg_light),
        ('BACKGROUND', (0, 3), (-1, 3), colors.white),
        ('BACKGROUND', (0, 4), (-1, 4), bg_light),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(roadmap_table)
    story.append(Spacer(1, 18))

    # =========================================================================
    # CIERRE Y FIRMA DEL DOCUMENTO
    # =========================================================================
    story.append(HRFlowable(width="100%", thickness=1, color=accent, spaceBefore=6, spaceAfter=10))
    closing_text = (
        "<b>Dictamen de Ingeniería:</b> La arquitectura actual posee una solidez matemática del 85% para operar en mercados modernos. "
        "La integración paulatina de los Pilares D, E y F descritos en esta hoja de ruta garantizará que, cuando el portafolio cruce "
        "las seis y siete cifras, la seguridad, la invisibilidad táctica y la rentabilidad continúen operando con la precisión de un fondo de inversión institucional."
    )
    story.append(Paragraph(closing_text, body_style))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"[OK] PDF generado exitosamente en: {filename}")

if __name__ == '__main__':
    desktop_dir = os.path.expanduser('~/Desktop')
    out_pdf = os.path.join(desktop_dir, 'NEXUS_QUANT_V3_ROADMAP_INSTITUCIONAL.pdf')
    build_pdf(out_pdf)
