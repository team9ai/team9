import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
});

function Privacy() {
  return (
    <div className="min-h-screen bg-white py-12">
      <div className="w-full max-w-3xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <Link
            to="/register"
            className="inline-flex items-center gap-1.5 text-purple-600 hover:underline text-sm font-medium mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Privacy Policy
          </h1>
          <p className="text-gray-500 text-sm">
            Effective Date: January 30, 2026
          </p>
        </div>

        <div className="prose prose-gray max-w-none">
          <p className="text-gray-700 leading-relaxed mb-8">
            This Privacy Policy describes how Team9 ("we", "us", or "our")
            collects, uses, and discloses information associated with an
            identified or identifiable individual ("Personal Data") through our
            AI-powered workplace productivity platform, including the associated
            mobile and desktop applications (collectively, the "Services"),
            team9.ai (the "Websites"), and other interactions you may have with
            us.
          </p>

          {/* Section 1 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              1. Applicability and Absolute Third-Party Disclaimer
            </h2>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              1.1 Scope of Policy
            </h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              This policy applies only to the official Services provided
              directly by Team9. By using our Services, you acknowledge that you
              have read and understood this policy.
            </p>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              1.2 Third-Party AI Services
            </h3>
            <p className="text-gray-700 leading-relaxed mb-3">
              The Services integrate AI models and APIs provided by third-party
              vendors (e.g., OpenAI, Anthropic, Google). You acknowledge that:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li>
                <strong>No Control:</strong> Team9 does not own or control the
                underlying AI models.
              </li>
              <li>
                <strong>Independent Policies:</strong> These providers operate
                under their own privacy policies. Once data is transmitted to
                them via API for processing, it is subject to their data
                handling practices.
              </li>
              <li>
                <strong>No Liability:</strong> Team9 assumes no responsibility
                for any inaccuracies, "hallucinations," data breaches, or
                privacy violations occurring within third-party AI
                infrastructures.
              </li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              1.3 Third-Party Skills, Bots, and APIs
            </h3>
            <p className="text-gray-700 leading-relaxed mb-3">
              Our platform allows for the integration of tools, "Skills,"
              "Bots," and applications developed by independent third parties
              ("Third-Party Components").
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li>
                <strong>Total Waiver of Liability:</strong> Team9 does not
                manage, audit, or guarantee the privacy practices of any
                Third-Party Components.
              </li>
              <li>
                <strong>User Responsibility:</strong> Your interaction with any
                Third-Party Component is a direct legal relationship between you
                and that third party. Team9 is not responsible for any data
                misuse or security failures by these developers.
              </li>
            </ul>
          </section>

          {/* Section 2 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              2. Information We Collect and Receive
            </h2>
            <p className="text-gray-700 leading-relaxed mb-3">
              Team9 collects information through the operation of the Services
              and other interactions:
            </p>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              2.1 Customer Data
            </h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              Users routinely submit content to the Services, including
              messages, files, and AI Prompts/Inputs. This data is controlled by
              the "Customer" (the organization that created the workspace).
            </p>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              2.2 Other Information
            </h3>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li>
                <strong>AI Usage Metadata:</strong> Logs of prompt frequency, AI
                models utilized, and performance metrics.
              </li>
              <li>
                <strong>Account Information:</strong> Email address, name, and
                billing details.
              </li>
              <li>
                <strong>Log and Device Data:</strong> IP addresses, browser
                settings, device identifiers, and crash data.
              </li>
              <li>
                <strong>Third-Party Integration Data:</strong> Information
                received when you connect Team9 with external tools (e.g.,
                Google Drive, GitHub, or custom APIs).
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              3. How We Process Data and AI Training Limits
            </h2>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              3.1 Processing Purposes
            </h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              We use your information to operate the Services, facilitate
              AI-generated responses, prevent fraud, and comply with legal
              obligations.
            </p>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              3.2 AI Training Policy
            </h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              Team9 does <strong>NOT</strong> use your private Customer Data or
              AI Prompts to train global foundation models (such as GPT-4 or
              Claude) without your explicit opt-in. We may use de-identified,
              aggregated usage metadata to optimize our internal routing logic
              and platform features.
            </p>
          </section>

          {/* Section 4 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              4. Data Retention and Absolute Disclaimer on Data Loss
            </h2>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              4.1 Retention
            </h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              We retain data in accordance with the Customer's instructions and
              for as long as necessary to provide the Services.
            </p>

            <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
              4.2 No Guarantee of Data Preservation
            </h3>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li>
                <strong>No Backup Service:</strong> Team9 is NOT a data backup
                or archival service.
              </li>
              <li>
                <strong>Exclusion of Liability:</strong> Team9 shall have no
                liability for any loss, corruption, or deletion of data,
                regardless of the cause (including system failures,
                cyberattacks, third-party service outages, or user error).
              </li>
              <li>
                <strong>User Obligation:</strong> You are solely responsible for
                maintaining independent, regular backups of all critical
                Customer Data and AI conversation histories.
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              5. How We Share and Disclose Information
            </h2>
            <p className="text-gray-700 leading-relaxed mb-3">
              We share information only in accordance with the following:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li>
                <strong>Customer Instructions:</strong> Data is shared within
                the workspace as configured by the Customer.
              </li>
              <li>
                <strong>Third-Party Components:</strong> If you call a
                Third-Party Skill or Bot, we transmit necessary data to that
                developer to execute the request. Once data leaves Team9's
                environment, our responsibility terminates.
              </li>
              <li>
                <strong>Legal Mandate:</strong> We may disclose data if required
                by law, regulation, or a valid legal process (e.g., a subpoena).
              </li>
              <li>
                <strong>Sub-processors:</strong> We use trusted infrastructure
                providers (e.g., AWS) to store and process data.
              </li>
            </ul>
          </section>

          {/* Section 6 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              6. User Security Responsibilities
            </h2>
            <p className="text-gray-700 leading-relaxed mb-3">
              You acknowledge that the security of your data depends on your
              behavior:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li>
                <strong>Sensitive Information:</strong> You are strictly
                prohibited from inputting highly sensitive data (e.g., trade
                secrets or health records) into untrusted or non-official
                Third-Party Bots.
              </li>
              <li>
                <strong>Audit Duty:</strong> You are responsible for auditing
                the safety of any Third-Party Skill before enabling it.
              </li>
            </ul>
          </section>

          {/* Section 7 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              7. Age Limitations
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              To the extent prohibited by law, our Services are not intended for
              anyone under the age of sixteen (16). We do not knowingly collect
              personal data from minors.
            </p>
          </section>

          {/* Section 8 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              8. Changes to This Privacy Policy
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Team9 may modify this policy at any time. Material changes will be
              notified via email or through the Services. Your continued use of
              the Services after such modifications constitutes an unconditional
              acceptance of the revised policy.
            </p>
          </section>

          {/* Section 9 */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              9. Contact Us
            </h2>
            <p className="text-gray-700 leading-relaxed mb-2">
              For questions regarding this policy or to exercise your statutory
              rights, please contact:
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-3">
              <p className="text-gray-900 font-semibold mb-1">
                Team9 Legal Department
              </p>
              <p className="text-gray-700">
                Email:{" "}
                <a
                  href="mailto:legal@team9.ai"
                  className="text-purple-600 hover:underline"
                >
                  legal@team9.ai
                </a>
              </p>
              <p className="text-gray-700">
                Web:{" "}
                <a
                  href="https://team9.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:underline"
                >
                  https://team9.ai
                </a>
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 pt-6 mt-10 text-center text-xs text-gray-500">
          <p>&copy; {new Date().getFullYear()} Team9. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
