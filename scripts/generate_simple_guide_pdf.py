# scripts/generate_simple_guide_pdf.py
# Generador Profesional de PDF: NEXUS QUANT SUITE — GUÍA EXPLICATIVA EN PALABRAS SENCILLAS

import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak
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
        
        # Header (en páginas posteriores a la primera)
        if self._pageNumber > 1:
            self.drawString(54, 750, "NEXUS QUANT SUITE — GUÍA EXPLICATIVA: ¿CÓMO FUNCIONA EL SISTEMA?")
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(54, 742, 558, 742)
        
        # Footer
        self.setFont("Helvetica", 8)
        self.drawString(54, 35, "DOCUMENTO INFORMATIVO Y EDUCATIVO — SHION & NEXUS QUANT")
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

    # Colores institucionales
    primary = colors.HexColor("#0F172A")    # Slate 900
    accent = colors.HexColor("#0284C7")     # Sky 600
    emerald = colors.HexColor("#059669")    # Emerald 600
    dark_text = colors.HexColor("#1E293B")  # Slate 800
    sub_text = colors.HexColor("#475569")   # Slate 600
    bg_light = colors.HexColor("#F8FAFC")   # Slate 50
    border_color = colors.HexColor("#E2E8F0")

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=primary,
        spaceAfter=6
    )

    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        leading=15,
        textColor=accent,
        spaceAfter=14
    )

    h1_style = ParagraphStyle(
        'Header1',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=primary,
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Header2',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=accent,
        spaceBefore=10,
        spaceAfter=5,
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

    story = []

    # =========================================================================
    # ENCABEZADO / TITULAR
    # =========================================================================
    story.append(Paragraph("NEXUS QUANT SUITE — MANUAL DE ENTENDIMIENTO", subtitle_style))
    story.append(Paragraph("¿CÓMO FUNCIONA EL SISTEMA DE TRADING CUANTITATIVO?", title_style))
    story.append(Paragraph("Guía en palabras sencillas para explicar la lógica, la seguridad y el modelo de negocio", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=accent, spaceBefore=2, spaceAfter=12))

    # Tarjeta de Presentación
    summary_box = [
        [Paragraph("<b>La Idea en una sola frase:</b>", callout_style)],
        [Paragraph(
            "Nexus Quant Suite es un software institucional autónomo que gestiona un portafolio de <b>$100,000 USD las 24 horas del día en la red de Solana</b>. "
            "En lugar de 'adivinar' el futuro o apostar como en un casino, utiliza matemática, velocidad de milisegundos y cobertura de riesgo para "
            "generar ganancias consistentes protegiendo siempre el capital.",
            body_style
        )]
    ]
    summary_table = Table(summary_box, colWidths=[504])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#EFF6FF")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#BFDBFE")),
        ('PADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 1: CÓMO DIVIDE EL DINERO (LA REGLA DEL 70 / 30)
    # =========================================================================
    story.append(Paragraph("1. ¿Cómo se Divide y se Cuida el Dinero? (La Regla del 70 / 30)", h1_style))
    story.append(Paragraph(
        "El mayor error que comete el 95% de la gente que pierde dinero en cripto es arriesgar el 100% de su capital en operaciones volátiles. "
        "Si el mercado se desploma un 40%, pierden casi la mitad de sus ahorros. <b>Nexus Quant hace exactamente lo contrario:</b>",
        body_style
    ))

    capital_split_data = [
        [
            Paragraph("<b>70% del Capital ($70,000 USD)</b><br/><font color='#0284C7'>Bóveda Aether (Delta-Neutral)</font>", callout_style),
            Paragraph("<b>30% del Capital ($10,000 a $30,000 USD)</b><br/><font color='#059669'>Operaciones Rápidas (Sentinel & Catalyst)</font>", callout_style)
        ],
        [
            Paragraph(
                "• <b>Completamente Blindado:</b> No pierde dinero aunque el mercado caiga a cero.<br/>"
                "• <b>Renta Pasiva Fija:</b> Genera ~19.5% anual en comisiones de financiamiento.<br/>"
                "• <b>Rendimiento Diario:</b> Cosecha ~$37.40 USD al día de forma automática sin riesgo de precio.",
                body_style
            ),
            Paragraph(
                "• <b>Tamaño Pequeño:</b> Solo arriesga slots de $5,000 USD por operación.<br/>"
                "• <b>Francotirador:</b> Solo entra cuando hay ventajas estadísticas extremas.<br/>"
                "• <b>Corte Rápido:</b> Si una operación falla, se cierra en segundos perdiendo una fracción mínima.",
                body_style
            )
        ]
    ]
    split_table = Table(capital_split_data, colWidths=[250, 254])
    split_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), bg_light),
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('PADDING', (0, 0), (-1, -1), 7),
    ]))
    story.append(split_table)
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 2: LOS TRES MOTORES EXPLICADOS FÁCIL
    # =========================================================================
    story.append(Paragraph("2. Los Tres Motores del Sistema Explicados Fácil", h1_style))
    story.append(Paragraph(
        "El software funciona gracias a tres robots especializados que cooperan entre sí como un equipo coordinado:",
        body_style
    ))

    # Motor 1: Aether
    story.append(Paragraph("A. Motor Aether: La Bóveda de Renta Pasiva ($70,000 USD)", h2_style))
    story.append(Paragraph(
        "<b>¿Cómo es posible ganar dinero sin riesgo de que la moneda caiga?</b><br/>"
        "Aether utiliza una estrategia llamada <b>Delta-Neutral</b>: compra $35,000 USD de Solana al contado (Spot) y al mismo segundo "
        "abre una venta corta de $35,000 USD en contratos de futuros perpetuos.<br/>"
        "• Si Solana sube un 50%, lo que gana la compra lo pierde la venta.<br/>"
        "• Si Solana cae un 80%, lo que pierde la compra lo gana la venta.<br/>"
        "<b>El valor de la cuenta siempre se mantiene en exactamente $70,000 USD.</b><br/>"
        "<b>¿De dónde sale la ganancia?</b> Los traders que operan apalancados pagan una tasa diaria de financiamiento (<i>funding rate</i>) a las posiciones cortas. "
        "Aether cobra ese interés día y noche, generando un flujo constante de dinero en efectivo sin importar si el mercado está alcista o bajista.",
        body_style
    ))

    # Motor 2: Sentinel
    story.append(Paragraph("B. Motor Sentinel: El Rastreador de Billeteras Millonarias (Ballenas)", h2_style))
    story.append(Paragraph(
        "En la blockchain todo es transparente. Sentinel vigila las <b>50 billeteras más ricas e inteligentes del mundo</b> (<i>Smart Money</i>).<br/>"
        "• <b>Consenso Institucional:</b> Cuando detecta que 3 o más de estas billeteras compran el mismo token en pocos minutos, sabe que hay dinero pesado entrando.<br/>"
        "• <b>Cero FOMO (No compra arriba):</b> Los aficionados compran cuando ven una vela verde gigante por miedo a quedarse fuera. Sentinel sabe que después de una subida fuerte siempre hay una corrección. "
        "Calcula un retroceso matemático (Fibonacci 38.2%) y coloca una orden de compra pasiva barata. <b>Compra con descuento cuando los demás tienen miedo.</b>",
        body_style
    ))

    # Motor 3: Catalyst
    story.append(Paragraph("C. Motor Catalyst: El Velocista de Noticias y Arbitraje en Milisegundos", h2_style))
    story.append(Paragraph(
        "Catalyst es el motor de alta frecuencia (HFT). Detecta eventos, noticias de impacto y listados en cuestión de <b>10 a 50 milisegundos</b>.<br/>"
        "• Un ser humano tarda 20 segundos en leer un titular, abrir la aplicación y pulsar comprar.<br/>"
        "• Catalyst compra en el milisegundo cero, cuando el precio todavía está abajo. <b>Cuando la masa de gente llega 20 segundos después a comprar por emoción, Catalyst ya les está vendiendo las monedas con un +1.50% de ganancia en el bolsillo.</b>",
        body_style
    ))
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 3: EL SECRETO CUANTITATIVO (POR QUÉ GANA ACERTANDO POCO)
    # =========================================================================
    story.append(Paragraph("3. El Secreto Cuantitativo: ¿Por qué Gana Dinero Acertando Solo la Mitad?", h1_style))
    story.append(Paragraph(
        "La mayoría de la gente cree que para ganar dinero en trading hay que acertar el 80% o 90% de las veces. Eso es falso y peligroso. "
        "El secreto de los fondos de inversión se llama <b>Asimetría Matemática</b>:",
        body_style
    ))

    story.append(Paragraph("• <b>Cuando el Bot Gana:</b> Vende con un objetivo estricto de <b>+1.50%</b> (gana entre <b>+$75 y +$85 USD</b>).", bullet_style))
    story.append(Paragraph("• <b>Cuando el Bot Falla:</b> El Stop-Loss corta de inmediato la pérdida en un <b>-0.80%</b> (pierde solo entre <b>-$35 y -$42 USD</b>).", bullet_style))

    story.append(Paragraph(
        "Como lo que gana en una operación buena es casi el doble de lo que pierde en una mala, <b>el bot solo necesita acertar el 35% de las veces para no perder dinero</b>.",
        body_style
    ))

    # Ejemplo de la Vida Real (Tus datos recientes)
    example_box = [
        [Paragraph("<b>Ejemplo Real en Vivo (Lo que viste en la pantalla hoy):</b>", callout_style)],
        [Paragraph(
            "• El bot ejecutó <b>18 operaciones</b>: ganó 8 y perdió 10 (acertó solo el <b>44.4%</b>).<br/>"
            "• Cualquiera pensaría que perdió dinero, pero ocurrió esto:<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;→ Ganancias de las 8 buenas: 8 × $75.00 = <b>+$600.00 USD</b><br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;→ Pérdidas de las 10 malas: 10 × $37.00 = <b>-$370.00 USD</b><br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;→ <b>Resultado Neto: +$230.00 USD de ganancia limpia en el bolsillo.</b>",
            body_style
        )]
    ]
    example_table = Table(example_box, colWidths=[504])
    example_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F0FDF4")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#BBF7D0")),
        ('PADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(example_table)
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 4: LA METÁFORA DEL CASINO
    # =========================================================================
    story.append(Paragraph("4. La Metáfora del Casino: De Apostador a Dueño de la Ruleta", h1_style))
    story.append(Paragraph(
        "Para explicárselo a cualquier persona, la mejor analogía es la de un casino:",
        body_style
    ))
    story.append(Paragraph("• <b>El Trader Novato es el Apostador:</b> Pone su dinero al rojo o al negro esperando tener un golpe de suerte. A veces gana mucho, pero a largo plazo casi siempre termina quebrado porque juega con las probabilidades en contra.", bullet_style))
    story.append(Paragraph("• <b>Nexus Quant es el Dueño del Casino:</b> No le importa si un jugador gana una mano individual hoy. Sabe que la ruleta tiene una ventaja matemática del 52.6% a favor de la casa. Con cientos de jugadas a lo largo de los días, <b>la matemática garantiza que la casa siempre termina ganando</b>.", bullet_style))
    story.append(Spacer(1, 14))

    # =========================================================================
    # SECCIÓN 5: QUÉ MUESTRA CADA PARTE DE LA PANTALLA (DASHBOARD)
    # =========================================================================
    story.append(Paragraph("5. ¿Qué Muestra la Pantalla del Dashboard?", h1_style))
    
    views_data = [
        [Paragraph("<b>Panel / Vista</b>", callout_style), Paragraph("<b>¿Qué hace y qué se ve ahí?</b>", callout_style)],
        [Paragraph("<b>Vista 1: Sentinel On-Chain</b>", body_style), Paragraph("El radar en tiempo real de las 50 billeteras de ballenas, mostrando qué compran y qué venden en vivo.", body_style)],
        [Paragraph("<b>Vista 2: Catalyst Engine</b>", body_style), Paragraph("El monitor de noticias y arbitraje de alta velocidad, capturando micro-impulsos en milisegundos.", body_style)],
        [Paragraph("<b>Vista 3: Historial de Trades</b>", body_style), Paragraph("El libro contable transparente donde queda grabada cada operación cerrada con su fecha, precio, ganancia en dólares y porcentaje.", body_style)],
        [Paragraph("<b>Vista 4: Aether Carry & Cola</b>", body_style), Paragraph("La bóveda de los $70,000 USD cosechando intereses pasivos y la sala de espera de compras con descuento Fibonacci.", body_style)],
        [Paragraph("<b>Botón Rojo: KILL-SWITCH</b>", body_style), Paragraph("Freno de emergencia atómico. Si hay una catástrofe mundial, cierra todo y congela el capital en dólares en 50 milisegundos.", body_style)]
    ]
    views_table = Table(views_data, colWidths=[160, 344])
    views_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), primary),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('BACKGROUND', (0, 1), (-1, 1), colors.white),
        ('BACKGROUND', (0, 2), (-1, 2), bg_light),
        ('BACKGROUND', (0, 3), (-1, 3), colors.white),
        ('BACKGROUND', (0, 4), (-1, 4), bg_light),
        ('BACKGROUND', (0, 5), (-1, 5), colors.white),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(views_table)
    story.append(Spacer(1, 16))

    # =========================================================================
    # CONCLUSIÓN
    # =========================================================================
    story.append(HRFlowable(width="100%", thickness=1, color=accent, spaceBefore=4, spaceAfter=8))
    story.append(Paragraph(
        "<b>En resumen:</b> Este bot no es una máquina de azar ni una promesa mágica. Es una herramienta de ingeniería financiera que "
        "reemplaza las emociones humanas (la codicia, el pánico y el miedo) por <b>probabilidad estadística, velocidad de ejecución y preservación matemática del capital</b>.",
        body_style
    ))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"[OK] PDF explicativo generado exitosamente en: {filename}")

if __name__ == '__main__':
    desktop_dir = os.path.expanduser('~/Desktop')
    out_pdf = os.path.join(desktop_dir, 'NEXUS_QUANT_GUIA_EXPLICATIVA.pdf')
    build_pdf(out_pdf)
