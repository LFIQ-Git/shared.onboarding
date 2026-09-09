import jsPDF from 'jspdf'

export async function generatePDF(baseURL: string): Promise<Buffer> {
  try {
    const response = await fetch(`${baseURL}/docs`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch docs page: ${response.statusText}`)
    }

    const html = await response.text()

    // Extract text content from HTML (simple fallback approach)
    // This removes HTML tags but preserves document structure
    const stripHtml = (str: string) => {
      return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const textContent = stripHtml(html)

    // Create PDF with text content
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })

    const pageHeight = pdf.internal.pageSize.getHeight()
    const pageWidth = pdf.internal.pageSize.getWidth()
    const margin = 15
    const lineHeight = 7
    const maxWidth = pageWidth - margin * 2

    // Set font
    pdf.setFont('Helvetica')
    pdf.setFontSize(11)

    // Split text into lines that fit the page width
    const lines = pdf.splitTextToSize(textContent, maxWidth)

    let yPosition = margin

    for (const line of lines) {
      // Check if we need a new page
      if (yPosition + lineHeight > pageHeight - margin) {
        pdf.addPage()
        yPosition = margin
      }

      pdf.text(line, margin, yPosition)
      yPosition += lineHeight
    }

    // Return as buffer
    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'))
    return pdfBuffer
  } catch (error) {
    console.error('PDF generation error:', error)
    throw error
  }
}
