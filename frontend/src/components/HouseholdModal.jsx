import { useState, useEffect } from 'react'
import { api } from '../services/apiClient'
import AdaptiveModal from './AdaptiveModal'

function HouseholdModal({ isOpen, onClose, userId, onHouseholdChange }) {
  const [household, setHousehold] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('view') // 'view', 'create', 'join'
  
  // Form states
  const [householdName, setHouseholdName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isOpen && userId) {
      fetchHousehold()
    }
  }, [isOpen, userId])

  const fetchHousehold = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.getHousehold(userId)
      setHousehold(response.household)
      
      if (response.household) {
        const membersResponse = await api.getHouseholdMembers(userId)
        setMembers(membersResponse.members || [])
        setActiveTab('view')
      } else {
        setActiveTab('create')
      }
    } catch (err) {
      setError('Failed to load household information')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateHousehold = async (e) => {
    e.preventDefault()
    if (!householdName.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      const response = await api.createHousehold(userId, householdName.trim())
      setHousehold(response.household)
      setMembers([{ user_id: userId, role: 'owner' }])
      setHouseholdName('')
      setActiveTab('view')
      onHouseholdChange?.(response.household)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create household')
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoinHousehold = async (e) => {
    e.preventDefault()
    if (!joinCode.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      const response = await api.joinHousehold(userId, joinCode.trim().toUpperCase())
      setHousehold(response.household)
      setJoinCode('')
      await fetchHousehold()
      onHouseholdChange?.(response.household)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join household')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLeaveHousehold = async () => {
    if (!confirm('Are you sure you want to leave this household?')) return

    setSubmitting(true)
    setError(null)
    try {
      await api.leaveHousehold(userId)
      setHousehold(null)
      setMembers([])
      setActiveTab('create')
      onHouseholdChange?.(null)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to leave household')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegenerateCode = async () => {
    if (!confirm('Regenerate join code? The old code will no longer work.')) return

    setSubmitting(true)
    try {
      const response = await api.regenerateJoinCode(userId)
      setHousehold({ ...household, join_code: response.join_code })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to regenerate code')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(household?.join_code || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRemoveMember = async (memberUserId) => {
    if (!confirm('Remove this member from the household?')) return

    try {
      await api.removeMember(userId, memberUserId)
      setMembers(members.filter(m => m.user_id !== memberUserId))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove member')
    }
  }

  return (
    <AdaptiveModal isOpen={isOpen} onClose={onClose} title="Household">
      <div className="p-4 sm:p-6">
      {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra"></div>
            </div>
          ) : (
            <>
              {error && (
                <div className="alert alert-error mb-4 text-sm" role="alert">
                  {error}
                </div>
              )}

              {/* Tabs when no household */}
              {!household && (
                <div className="flex border-b border-forest-light mb-4">
                  <button
                    onClick={() => setActiveTab('create')}
                    className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'create'
                        ? 'border-terra text-terra'
                        : 'border-transparent text-sage-light hover:text-cream'
                    }`}
                  >
                    Create New
                  </button>
                  <button
                    onClick={() => setActiveTab('join')}
                    className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'join'
                        ? 'border-terra text-terra'
                        : 'border-transparent text-sage-light hover:text-cream'
                    }`}
                  >
                    Join Existing
                  </button>
                </div>
              )}

              {/* View Household */}
              {household && activeTab === 'view' && (
                <div className="space-y-4">
                  {/* Household Info */}
                  <div className="bg-forest-light rounded-mise-md p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-cream">{household.name}</h3>
                        <p className="text-sm text-sage-light">
                          {household.role === 'owner' ? 'Owner' : 'Member'}
                        </p>
                      </div>
                      {household.role === 'owner' && (
                        <span className="px-2 py-1 bg-forest-light text-terra text-xs rounded-full">
                          Owner
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Join Code (owner only) */}
                  {household.role === 'owner' && (
                    <div className="bg-forest-light rounded-mise-md p-4">
                      <p className="text-sm text-sage-light mb-2">Share this code to invite members:</p>
                      <div className="flex items-center space-x-2">
                        <code className="flex-1 bg-forest-mid px-3 py-2 rounded-mise-sm border border-forest-light font-mono text-lg text-center tracking-widest text-cream">
                          {household.join_code}
                        </code>
                        <button
                          onClick={handleCopyCode}
                          className="px-3 py-2 btn btn-primary"
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleRegenerateCode}
                        disabled={submitting}
                        className="mt-2 text-sm text-terra-light hover:text-cream underline-offset-2 hover:underline"
                      >
                        Regenerate code
                      </button>
                    </div>
                  )}

                  {/* Members List */}
                  <div>
                    <h4 className="font-medium text-cream mb-2">
                      Members ({members.length})
                    </h4>
                    <div className="space-y-2">
                      {members.map((member) => (
                        <div
                          key={member.user_id}
                          className="flex items-center justify-between p-3 bg-forest-light rounded-mise-md"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-forest-mid rounded-full flex items-center justify-center border border-forest-light">
                              <svg className="w-4 h-4 text-sage-light" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-cream">
                                {member.user_id === userId ? 'You' : `Member`}
                              </p>
                              <p className="text-xs text-sage-light">{member.role}</p>
                            </div>
                          </div>
                          {household.role === 'owner' && member.user_id !== userId && (
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(member.user_id)}
                              className="text-sm text-[var(--color-error)] hover:opacity-90"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Leave Household */}
                  <button
                    onClick={handleLeaveHousehold}
                    disabled={submitting}
                    className="w-full mt-4 px-4 py-2 border border-[var(--color-error)] text-[var(--color-error)] rounded-mise-md hover:bg-[var(--color-error)]/10 transition-colors"
                  >
                    {household.role === 'owner' && members.length === 1 
                      ? 'Delete Household' 
                      : 'Leave Household'}
                  </button>
                </div>
              )}

              {/* Create Household Form */}
              {!household && activeTab === 'create' && (
                <form onSubmit={handleCreateHousehold} className="space-y-4">
                  <p className="text-sm text-sage-light">
                    Create a household to share your pantry and receipts with family members.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-sage-light mb-1">
                      Household Name
                    </label>
                    <input
                      type="text"
                      value={householdName}
                      onChange={(e) => setHouseholdName(e.target.value)}
                      placeholder="e.g., Smith Family"
                      className="input"
                      maxLength={100}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || !householdName.trim()}
                    className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Creating...' : 'Create Household'}
                  </button>
                </form>
              )}

              {/* Join Household Form */}
              {!household && activeTab === 'join' && (
                <form onSubmit={handleJoinHousehold} className="space-y-4">
                  <p className="text-sm text-sage-light">
                    Enter the 6-character code shared by the household owner.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-sage-light mb-1">
                      Join Code
                    </label>
                    <input
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="ABC123"
                      className="input font-mono text-center text-lg tracking-widest uppercase"
                      maxLength={6}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || joinCode.length !== 6}
                    className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Joining...' : 'Join Household'}
                  </button>
                </form>
              )}
            </>
          )}
      </div>
    </AdaptiveModal>
  )
}

export default HouseholdModal
